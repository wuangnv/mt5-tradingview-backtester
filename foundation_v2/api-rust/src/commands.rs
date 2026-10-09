use crate::{
    auth::{ApiError, Workspace},
    state::AppState,
};
use axum::{
    Json, Router,
    body::to_bytes,
    extract::{MatchedPath, Path, Request, State},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{MethodFilter, get, on},
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{sync::Arc, time::Duration};
use uuid::Uuid;

const CONTRACT: &str = "api-command-v1";
const FROZEN: &str = include_str!("../../trading_workspace_v2/command_routes.json");
pub fn required_worker_manifest() -> Value {
    json!(
        serde_json::from_str::<Vec<Route>>(FROZEN)
            .expect("reviewed route manifest")
            .into_iter()
            .filter(|r| !native(&r.method, &r.path))
            .map(|r| json!({"method":r.method,"path":r.path}))
            .collect::<Vec<_>>()
    )
}
pub fn allowed_methods(template: &str) -> Vec<String> {
    serde_json::from_str::<Vec<Route>>(FROZEN)
        .expect("reviewed route manifest")
        .into_iter()
        .filter(|route| route.path == template)
        .map(|route| route.method)
        .collect()
}
#[derive(Deserialize)]
struct Route {
    method: String,
    path: String,
}
fn native(method: &str, path: &str) -> bool {
    if method == "POST" && path == "/api/v2/execution/intents" {
        return true;
    }
    method == "GET"
        && matches!(
            path,
            "/health"
                | "/api/v2/replay/sessions"
                | "/api/v2/prop/sessions"
                | "/api/v2/prop/sessions/{session_id}"
                | "/api/v2/prop/sessions/{session_id}/attempts"
                | "/api/v2/prop/sessions/{session_id}/attempts/{attempt_id}"
                | "/api/v2/playbooks"
                | "/api/v2/playbooks/{record_id}"
                | "/api/v2/playbooks/{record_id}/revisions"
                | "/api/v2/journal"
                | "/api/v2/journal/{record_id}"
                | "/api/v2/journal/{record_id}/revisions"
                | "/api/v2/chart/annotations"
                | "/api/v2/execution/capabilities"
                | "/api/v2/session/status"
                | "/api/v2/research/jobs/{job_id}"
                | "/api/v2/research/jobs/{job_id}/checkpoint"
        )
}
pub fn routes() -> Router<Arc<AppState>> {
    let mut router = Router::new().route("/api/v2/commands/{command_id}", get(command_status));
    for route in serde_json::from_str::<Vec<Route>>(FROZEN).expect("reviewed route manifest") {
        if native(&route.method, &route.path) {
            continue;
        }
        let filter = match route.method.as_str() {
            "GET" => MethodFilter::GET,
            "POST" => MethodFilter::POST,
            "PATCH" => MethodFilter::PATCH,
            "PUT" => MethodFilter::PUT,
            "DELETE" => MethodFilter::DELETE,
            _ => panic!("unsupported manifest method"),
        };
        router = router.route(&route.path, on(filter, invoke));
    }
    router
}

fn query_pairs(query: Option<&str>) -> Value {
    json!(
        form_urlencoded::parse(query.unwrap_or_default().as_bytes())
            .map(|(a, b)| vec![a.into_owned(), b.into_owned()])
            .collect::<Vec<_>>()
    )
}
fn path_decode(path: &str) -> Result<String, ApiError> {
    let path = percent_encoding::percent_decode_str(path)
        .decode_utf8()
        .map_err(|_| ApiError::detail(StatusCode::BAD_REQUEST, "invalid_path_encoding"))?
        .into_owned();
    if path.len() > 2048
        || !path.starts_with('/')
        || path.chars().any(char::is_control)
        || path.contains(['?', '#'])
    {
        return Err(ApiError::detail(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_command_path",
        ));
    }
    Ok(path)
}
fn parse_body(bytes: &[u8]) -> Result<Option<Value>, ApiError> {
    if bytes.is_empty() {
        return Ok(None);
    }
    serde_json::from_slice(bytes).map(Some).map_err(|error| {
        let position=bytes.split(|v|*v==b'\n').take(error.line().saturating_sub(1)).map(|v|v.len()+1).sum::<usize>()+error.column().saturating_sub(1);
        ApiError(StatusCode::UNPROCESSABLE_ENTITY,json!({"detail":[{"type":"json_invalid","loc":["body",position],"msg":"JSON decode error","input":{},"ctx":{"error":error.to_string()}}]}))
    })
}
fn idempotency(headers: &HeaderMap) -> Result<Option<String>, ApiError> {
    let Some(value) = headers.get("idempotency-key") else {
        return Ok(None);
    };
    let value = value.to_str().map_err(|_| {
        ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, "invalid_idempotency_key")
    })?;
    if value.is_empty() || value.len() > 200 || value.chars().any(char::is_control) {
        return Err(ApiError::detail(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_idempotency_key",
        ));
    }
    Ok(Some(value.into()))
}
fn fingerprint(
    method: &str,
    path: &str,
    query: &Value,
    body: &Option<Value>,
    origin: &Option<String>,
) -> String {
    // Framed canonical JSON prevents ambiguity between concatenated command fields.
    let value = json!({"method":method,"path":path,"query":query,"body":body,"origin":origin});
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&value).expect("serializable command"))
    )
}

async fn invoke(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    matched: MatchedPath,
    request: Request,
) -> Result<Response, ApiError> {
    let method = request.method().as_str().to_owned();
    let path = path_decode(request.uri().path())?;
    let query = query_pairs(request.uri().query());
    let key = idempotency(request.headers())?;
    let origin = request
        .headers()
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let content_type = request
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let bytes = to_bytes(request.into_body(), state.config.max_body_bytes)
        .await
        .map_err(|_| ApiError::detail(StatusCode::PAYLOAD_TOO_LARGE, "request_body_too_large"))?;
    let body = parse_body_for_content_type(&bytes, content_type.as_deref())?;
    let hash = fingerprint(&method, &path, &query, &body, &origin);
    let id = enqueue(
        &state,
        &scope,
        &method,
        &path,
        matched.as_str(),
        &query,
        &body,
        &origin,
        &hash,
        &key,
    )
    .await?;
    let deadline = tokio::time::Instant::now() + state.config.command_wait_timeout;
    loop {
        let read =
            tokio::time::timeout(state.config.pool_timeout, read_result(&state, &scope, id)).await;
        if let Ok(Ok(Some(result))) = read
            && matches!(result.status.as_str(), "completed" | "failed")
        {
            return result.response(id);
        }
        if tokio::time::Instant::now() >= deadline {
            let mut response=(StatusCode::GATEWAY_TIMEOUT,Json(json!({"detail":"command_pending","command_id":id,"status_url":format!("/api/v2/commands/{id}"),"outcome_known":false}))).into_response();
            response
                .headers_mut()
                .insert("retry-after", HeaderValue::from_static("1"));
            response.headers_mut().insert(
                "x-command-id",
                HeaderValue::from_str(&id.to_string()).unwrap(),
            );
            return Ok(response);
        }
        tokio::time::sleep(Duration::from_millis(75)).await;
    }
}

fn parse_body_for_content_type(
    bytes: &[u8],
    content_type: Option<&str>,
) -> Result<Option<Value>, ApiError> {
    let content_type = content_type.map(|v| v.split(';').next().unwrap_or("").trim());
    if content_type.is_none_or(|v| {
        v == "application/json" || v.starts_with("application/") && v.ends_with("+json")
    }) {
        return parse_body(bytes);
    }
    if bytes.is_empty() {
        return Ok(None);
    }
    // The supported browser contract is JSON. Reject unsupported framing before a durable write.
    Err(ApiError::detail(
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
        "command_json_required",
    ))
}

#[allow(clippy::too_many_arguments)]
async fn enqueue(
    state: &AppState,
    scope: &Workspace,
    method: &str,
    path: &str,
    template: &str,
    query: &Value,
    body: &Option<Value>,
    origin: &Option<String>,
    hash: &str,
    key: &Option<String>,
) -> Result<Uuid, ApiError> {
    let mut conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = conn.transaction().await.map_err(|_| ApiError::database())?;
    let lock: i64 = 0x54574143;
    tx.query_one("SELECT pg_advisory_xact_lock($1)", &[&lock])
        .await
        .map_err(|_| ApiError::database())?;
    if let Some(key) = key {
        if let Some(row)=tx.query_opt("SELECT command_id,request_hash FROM api_commands WHERE workspace_id=$1 AND identity_id=$2 AND idempotency_key=$3 AND expires_at_utc>CURRENT_TIMESTAMP",&[&scope.workspace_id,&scope.subject,&key]).await.map_err(|_|ApiError::database())? {
            if row.get::<_,String>("request_hash")!=hash {return Err(ApiError::detail(StatusCode::CONFLICT,"command_idempotency_conflict"));}
            return Ok(row.get("command_id"));
        }
        // Expired receipts are removed under admission lock before reusing their unique key.
        tx.execute("DELETE FROM api_commands WHERE workspace_id=$1 AND identity_id=$2 AND idempotency_key=$3 AND expires_at_utc<=CURRENT_TIMESTAMP AND status IN ('completed','failed')",&[&scope.workspace_id,&scope.subject,&key]).await.map_err(|_|ApiError::database())?;
    }
    let manifest = json!([{"method":method,"path":template}]);
    let available=tx.query_one("SELECT EXISTS(SELECT 1 FROM api_command_workers WHERE contract_version=$1 AND heartbeat_at_utc>CURRENT_TIMESTAMP-interval '20 seconds' AND route_manifest @> $2::jsonb)",&[&CONTRACT,&manifest]).await.map_err(|_|ApiError::database())?.get::<_,bool>(0);
    if !available {
        return Err(ApiError::detail(
            StatusCode::SERVICE_UNAVAILABLE,
            "command_worker_unavailable",
        ));
    }
    let row=tx.query_one("SELECT count(*)::bigint AS total,count(*) FILTER(WHERE workspace_id=$1)::bigint AS scoped FROM api_commands WHERE status IN ('queued','running')",&[&scope.workspace_id]).await.map_err(|_|ApiError::database())?;
    if row.get::<_, i64>("total") >= 128 || row.get::<_, i64>("scoped") >= 32 {
        return Err(ApiError::detail(
            StatusCode::SERVICE_UNAVAILABLE,
            "command_queue_capacity_exceeded",
        ));
    }
    let id = Uuid::new_v4();
    let deadline_seconds = (state.config.command_wait_timeout.as_secs() + 10).max(30) as i32;
    let attempts: i32 = if method == "GET" && !path.contains("/oauth/") {
        3
    } else {
        1
    };
    tx.execute("INSERT INTO api_commands(command_id,contract_version,workspace_id,identity_id,method,path,query,body,origin,request_hash,idempotency_key,max_attempts,deadline_at_utc,expires_at_utc) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CURRENT_TIMESTAMP+make_interval(secs=>$13::integer),CURRENT_TIMESTAMP+interval '24 hours')",&[&id,&CONTRACT,&scope.workspace_id,&scope.subject,&method,&path,&query,&body,&origin,&hash,&key,&attempts,&deadline_seconds]).await.map_err(|_|ApiError::database())?;
    tx.commit().await.map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE,json!({"detail":"command_commit_outcome_unknown","command_id":id,"status_url":format!("/api/v2/commands/{id}"),"outcome_known":false})))?;
    tracing::info!(command_id=%id,method,route=template,"domain command admitted");
    Ok(id)
}

struct ResultRow {
    status: String,
    result_status: Option<i32>,
    headers: Option<Value>,
    body: Option<Value>,
    text: Option<String>,
    created: DateTime<Utc>,
    updated: DateTime<Utc>,
}
fn reviewed_headers(headers: Option<Value>) -> serde_json::Map<String, Value> {
    let mut reviewed = serde_json::Map::new();
    if let Some(headers) = headers.and_then(|v| v.as_object().cloned()) {
        for (name, value) in headers {
            let name = name.to_ascii_lowercase();
            if !matches!(
                name.as_str(),
                "content-type"
                    | "content-disposition"
                    | "cache-control"
                    | "pragma"
                    | "content-security-policy"
                    | "referrer-policy"
                    | "x-content-type-options"
                    | "retry-after"
            ) {
                continue;
            }
            if value
                .as_str()
                .is_some_and(|v| HeaderValue::from_str(v).is_ok())
            {
                reviewed.insert(name, value);
            }
        }
    }
    reviewed
}
async fn read_result(
    state: &AppState,
    scope: &Workspace,
    id: Uuid,
) -> Result<Option<ResultRow>, ApiError> {
    let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let row=conn.query_opt("SELECT status,result_status,result_headers,result_body,result_text,created_at_utc,updated_at_utc FROM api_commands WHERE command_id=$1 AND workspace_id=$2 AND identity_id=$3 AND expires_at_utc>CURRENT_TIMESTAMP",&[&id,&scope.workspace_id,&scope.subject]).await.map_err(|_|ApiError::database())?;
    Ok(row.map(|r| ResultRow {
        status: r.get("status"),
        result_status: r.get("result_status"),
        headers: r.get("result_headers"),
        body: r.get("result_body"),
        text: r.get("result_text"),
        created: r.get("created_at_utc"),
        updated: r.get("updated_at_utc"),
    }))
}
impl ResultRow {
    fn response(self, id: Uuid) -> Result<Response, ApiError> {
        let status = self
            .result_status
            .and_then(|v| StatusCode::from_u16(v as u16).ok())
            .filter(|v| v.as_u16() >= 200)
            .ok_or_else(|| {
                ApiError::detail(StatusCode::SERVICE_UNAVAILABLE, "command_result_untrusted")
            })?;
        let mut response = if let Some(text) = self.text {
            (status, text).into_response()
        } else {
            (status, Json(self.body.unwrap_or(Value::Null))).into_response()
        };
        for (name, value) in reviewed_headers(self.headers) {
            response.headers_mut().insert(
                HeaderName::from_bytes(name.as_bytes()).unwrap(),
                HeaderValue::from_str(value.as_str().unwrap()).unwrap(),
            );
        }
        response.headers_mut().insert(
            "x-command-id",
            HeaderValue::from_str(&id.to_string()).unwrap(),
        );
        Ok(response)
    }
}
async fn command_status(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = id
        .parse::<Uuid>()
        .map_err(|_| ApiError::detail(StatusCode::NOT_FOUND, "command_not_found"))?;
    let result = read_result(&state, &scope, id)
        .await?
        .ok_or_else(|| ApiError::detail(StatusCode::NOT_FOUND, "command_not_found"))?;
    Ok(Json(
        json!({"contract_version":CONTRACT,"command_id":id,"workspace_id":scope.workspace_id,"status":result.status,"result_status":result.result_status,"result_headers":reviewed_headers(result.headers),"result_body":result.body,"result_text":result.text,"created_at_utc":result.created,"updated_at_utc":result.updated}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    #[test]
    fn frozen_manifest_unique_and_native_routes_do_not_collide() {
        let manifest: Vec<Route> = serde_json::from_str(FROZEN).unwrap();
        let mut seen = HashSet::new();
        assert_eq!(manifest.len(), 98);
        for item in manifest {
            assert!(seen.insert((item.method, item.path)));
        }
        let _ = routes()
            .merge(crate::catalog::routes())
            .merge(crate::jobs::routes())
            .merge(crate::events::routes());
    }
    #[test]
    fn command_framing_preserves_duplicates_and_rejects_malformed() {
        assert_eq!(
            query_pairs(Some("x=a&x=b&label=hello+world")),
            json!([["x", "a"], ["x", "b"], ["label", "hello world"]])
        );
        assert_eq!(
            path_decode("/api/v2/journal/a%20b").unwrap(),
            "/api/v2/journal/a b"
        );
        assert!(path_decode("/x/%FF").is_err());
        assert!(parse_body(b"{broken").is_err());
        assert_eq!(parse_body(b"").unwrap(), None);
        let a = parse_body(br#"{"b":1,"a":2}"#).unwrap();
        let b = parse_body(br#"{"a":2,"b":1}"#).unwrap();
        assert_eq!(
            fingerprint("POST", "/a", &json!([]), &a, &None),
            fingerprint("POST", "/a", &json!([]), &b, &None)
        );
        assert_ne!(
            fingerprint("POST", "/a", &json!([]), &a, &None),
            fingerprint("POST", "/a", &json!([]), &a, &Some("http://other".into()))
        );
    }
    #[test]
    fn worker_response_only_exports_reviewed_headers() {
        let result = ResultRow {
            status: "completed".into(),
            result_status: Some(201),
            headers: Some(
                json!({"content-type":"text/csv","set-cookie":"secret","location":"http://evil"}),
            ),
            body: None,
            text: Some("a,b".into()),
            created: Utc::now(),
            updated: Utc::now(),
        };
        let response = result.response(Uuid::nil()).unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        assert_eq!(response.headers()["content-type"], "text/csv");
        assert!(!response.headers().contains_key("set-cookie"));
        assert!(!response.headers().contains_key("location"));
    }
    #[tokio::test]
    async fn malformed_body_rejected_before_queue_io() {
        use axum::{body::Body, http::Request};
        use tower::ServiceExt;
        let app = crate::router(crate::tests::fixture(10), routes());
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v2/replay/sessions")
                    .header("x-workspace-id", "a")
                    .header("content-type", "application/json")
                    .body(Body::from("{broken"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let value: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
        assert_eq!(value["detail"][0]["type"], "json_invalid");
    }
}
