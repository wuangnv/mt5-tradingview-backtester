use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpStream},
    time::Duration,
};
use tower::ServiceExt;
use trading_workspace_api::{catalog, config::Config, events, jobs, state::AppState};

struct Wire {
    status: u16,
    reader: BufReader<TcpStream>,
    pending: String,
}
impl Wire {
    fn connect(address: SocketAddr, workspace: Option<&str>) -> Self {
        let mut socket = TcpStream::connect(address).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(8)))
            .unwrap();
        let scope = workspace
            .map(|v| format!("X-Workspace-Id: {v}\r\n"))
            .unwrap_or_default();
        write!(socket,"GET /api/v2/events HTTP/1.1\r\nHost: {address}\r\n{scope}Accept: text/event-stream\r\n\r\n").unwrap();
        let mut reader = BufReader::new(socket);
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        let status = line.split_whitespace().nth(1).unwrap().parse().unwrap();
        loop {
            line.clear();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
        }
        Self {
            status,
            reader,
            pending: String::new(),
        }
    }
    fn snapshot(&mut self) -> Value {
        assert_eq!(self.status, 200);
        loop {
            if let Some(end) = self.pending.find("\n\n") {
                let frame = self.pending[..end].to_owned();
                self.pending = self.pending[end + 2..].to_owned();
                if frame.lines().any(|line| line == "event: snapshot") {
                    return serde_json::from_str(
                        frame
                            .lines()
                            .find_map(|line| line.strip_prefix("data: "))
                            .unwrap(),
                    )
                    .unwrap();
                }
                continue;
            }
            let mut size = String::new();
            self.reader.read_line(&mut size).unwrap();
            let size = usize::from_str_radix(size.trim().split(';').next().unwrap(), 16).unwrap();
            assert!(size > 0);
            let mut bytes = vec![0; size];
            self.reader.read_exact(&mut bytes).unwrap();
            let mut crlf = [0; 2];
            self.reader.read_exact(&mut crlf).unwrap();
            assert_eq!(&crlf, b"\r\n");
            self.pending.push_str(std::str::from_utf8(&bytes).unwrap());
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires owned fixture PostgreSQL from run_events_parity.py"]
async fn native_jobs_and_sse_durable_http_contract() {
    let golden: Value =
        serde_json::from_slice(&std::fs::read(std::env::var("TW_EVENTS_GOLDEN").unwrap()).unwrap())
            .unwrap();
    let state = AppState::connect(Config::from_environment().unwrap())
        .await
        .unwrap();
    let conn = state.pool.get().await.unwrap();
    let database: String = conn
        .query_one("SELECT current_database()", &[])
        .await
        .unwrap()
        .get(0);
    assert!(
        database.starts_with("events_parity_"),
        "refuse non-fixture DB"
    );
    let config = state.config.clone();
    let digest: String = conn
        .query_one(
            "SELECT sha256 FROM tw_schema_migrations WHERE version='0004_download_jobs.sql'",
            &[],
        )
        .await
        .unwrap()
        .get(0);
    conn.execute(
        "UPDATE tw_schema_migrations SET sha256='tampered' WHERE version='0004_download_jobs.sql'",
        &[],
    )
    .await
    .unwrap();
    assert!(
        AppState::connect(config.clone())
            .await
            .err()
            .unwrap()
            .contains("checksum mismatch")
    );
    conn.execute(
        "DELETE FROM tw_schema_migrations WHERE version='0004_download_jobs.sql'",
        &[],
    )
    .await
    .unwrap();
    assert!(
        AppState::connect(config.clone())
            .await
            .err()
            .unwrap()
            .contains("migration missing")
    );
    conn.execute(
        "INSERT INTO tw_schema_migrations(version,sha256) VALUES('0004_download_jobs.sql',$1)",
        &[&digest],
    )
    .await
    .unwrap();
    conn.execute(
        "INSERT INTO tw_schema_migrations(version,sha256) VALUES('9999_future.sql','future')",
        &[],
    )
    .await
    .unwrap();
    assert!(
        AppState::connect(config.clone())
            .await
            .err()
            .unwrap()
            .contains("newer")
    );
    conn.execute(
        "DELETE FROM tw_schema_migrations WHERE version='9999_future.sql'",
        &[],
    )
    .await
    .unwrap();
    conn.batch_execute("ALTER TABLE tw_schema_migrations RENAME TO fixture_saved_migrations")
        .await
        .unwrap();
    assert!(
        AppState::connect(config.clone())
            .await
            .err()
            .unwrap()
            .contains("ledger unavailable")
    );
    conn.batch_execute("ALTER TABLE fixture_saved_migrations RENAME TO tw_schema_migrations")
        .await
        .unwrap();
    let restored = AppState::connect(config).await.unwrap();
    restored.pool.close();
    let app = trading_workspace_api::router(
        state.clone(),
        catalog::routes()
            .merge(jobs::routes())
            .merge(events::routes()),
    );
    for case in golden["cases"].as_array().unwrap() {
        if !case["checkpoint"].is_null() {
            conn.execute("UPDATE research_jobs SET checkpoint_json=$1 WHERE workspace_id='tenant-a' AND job_id=$2",&[&case["checkpoint"],&case["job_id"].as_str().unwrap()]).await.unwrap();
        }
        let mut req = Request::builder().uri(case["path"].as_str().unwrap());
        if let Some(workspace) = case["workspace"].as_str() {
            req = req.header("x-workspace-id", workspace)
        }
        let response = app
            .clone()
            .oneshot(req.body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(
            response.status().as_u16(),
            case["status"].as_u64().unwrap() as u16,
            "{}",
            case["path"]
        );
        let actual: Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(actual, case["body"], "{}", case["path"]);
    }
    // Corrupt completed artifacts fail closed; no unchecked or partial result is published.
    let id = golden["completed_id"].as_str().unwrap();
    conn.execute("UPDATE research_jobs SET result_sha256=repeat('0',64) WHERE workspace_id='tenant-a' AND job_id=$1",&[&id]).await.unwrap();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v2/research/jobs/{id}"))
                .header("x-workspace-id", "tenant-a")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 503);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    // Actual socket HTTP, including middleware authentication before stream subscription.
    assert_eq!(Wire::connect(address, None).status, 422);
    assert_eq!(Wire::connect(address, Some("denied")).status, 403);
    let mut a = Wire::connect(address, Some("tenant-a"));
    let initial = a.snapshot();
    assert_eq!(initial["workspace_id"], "tenant-a");
    assert_eq!(
        initial["downloads"]["qdm"]["jobs"][0]["transferred_bytes"],
        Value::Null
    );
    assert!(initial.to_string().find("private-secret").is_none());
    let mut b = Wire::connect(address, Some("tenant-b"));
    let other = b.snapshot();
    assert_eq!(other["downloads"]["qdm"]["jobs"], json!([]));
    let job = golden["active_id"].as_str().unwrap();
    conn.execute("WITH research AS (UPDATE research_jobs SET status='failed',updated_at_utc='2026-10-09T20:01:00Z' WHERE workspace_id='tenant-a' AND job_id=$1 RETURNING job_id) UPDATE download_jobs SET payload=jsonb_set(payload,'{status}','\"completed\"'),public_snapshot=jsonb_set(public_snapshot,'{status}','\"completed\"'),revision=revision+1 WHERE workspace_id='tenant-a'",&[&job]).await.unwrap();
    let updated = a.snapshot();
    assert_ne!(updated["revision"], initial["revision"]);
    assert_eq!(
        updated["downloads"]["qdm"]["jobs"][0]["status"],
        "completed"
    );
    assert!(
        updated["research"]["recent_jobs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["job_id"] == job && item["status"] == "failed")
    );
    drop(a);
    drop(b);
    tokio::time::sleep(Duration::from_millis(100)).await;
    let mut reconnected = Wire::connect(address, Some("tenant-a"));
    assert_eq!(reconnected.snapshot()["revision"], updated["revision"]);
    drop(reconnected);
    tokio::time::sleep(Duration::from_millis(100)).await;
    // Body-lifetime resource admission: 8/workspace, 64 total, released on socket disconnect.
    let mut streams = Vec::new();
    for workspace in 0..8 {
        for _ in 0..8 {
            let stream = Wire::connect(address, Some(&format!("limit-{workspace}")));
            assert_eq!(stream.status, 200);
            streams.push(stream)
        }
    }
    assert_eq!(Wire::connect(address, Some("limit-0")).status, 429);
    assert_eq!(Wire::connect(address, Some("limit-8")).status, 429);
    streams.pop();
    tokio::time::sleep(Duration::from_millis(100)).await;
    let mut released = Wire::connect(address, Some("limit-8"));
    assert_eq!(released.status, 200);
    assert_eq!(released.snapshot()["workspace_id"], "limit-8");
    drop(released);
    drop(streams);
    server.abort();
    state.pool.close();
    println!(
        "{} job/checkpoint parity cases + startup migration missing/mismatch/future/absent fail-closed + SSE HTTP scope, durable updates, reconnect, checksum, 8/64 limits and disconnect release passed",
        golden["cases"].as_array().unwrap().len()
    );
}
