use crate::{
    auth::{ApiError, Workspace},
    state::AppState,
};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::get,
};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    path::{Component, PathBuf},
    sync::Arc,
};

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/v2/research/jobs/{job_id}", get(job))
        .route("/api/v2/research/jobs/{job_id}/checkpoint", get(checkpoint))
}

const JOB_QUERY: &str = "SELECT job_id,workspace_id,dataset_id,strategy_version,starting_balance,protocol_sha256,protocol_json,status,cancel_requested,result_path,result_sha256,error_code,created_at_utc,updated_at_utc FROM research_jobs WHERE workspace_id=$1 AND job_id=$2";

async fn job(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let row = conn
        .query_opt(JOB_QUERY, &[&scope.workspace_id, &id])
        .await
        .map_err(|_| ApiError::database())?
        .ok_or_else(|| ApiError::detail(StatusCode::NOT_FOUND, "job_not_found"))?;
    let status: String = row.get("status");
    let balance: f64 = row.get("starting_balance");
    let protocol: Option<Value> = row.get("protocol_json");
    if !matches!(
        status.as_str(),
        "queued" | "running" | "completed" | "failed" | "canceled"
    ) || !balance.is_finite()
        || balance <= 0.0
        || protocol.as_ref().is_some_and(|v| !v.is_object())
    {
        return Err(ApiError::detail(
            StatusCode::SERVICE_UNAVAILABLE,
            "job_untrusted",
        ));
    }
    let result_path: Option<String> = row.get("result_path");
    let result_sha256: Option<String> = row.get("result_sha256");
    let mut result = json!({
        "contract_version":crate::CONTRACT_VERSION,"job_id":row.get::<_,String>("job_id"),"workspace_id":scope.workspace_id,
        "dataset_id":row.get::<_,String>("dataset_id"),"strategy_version":row.get::<_,String>("strategy_version"),
        "starting_balance":balance,"protocol_sha256":row.get::<_,Option<String>>("protocol_sha256"),
        "protocol":protocol,"status":status,"cancel_requested":row.get::<_,bool>("cancel_requested"),
        "result_path":result_path,"result_sha256":result_sha256,"error_code":row.get::<_,Option<String>>("error_code"),
        "created_at_utc":row.get::<_,String>("created_at_utc"),"updated_at_utc":row.get::<_,String>("updated_at_utc")
    });
    drop(conn);
    if status == "completed" {
        result["result"] = match (result_path, result_sha256) {
            (Some(path), Some(hash)) => {
                let root = state.config.artifact_root.clone();
                let permit = state
                    .artifact_reads
                    .clone()
                    .try_acquire_owned()
                    .map_err(|_| {
                        ApiError::detail(
                            StatusCode::SERVICE_UNAVAILABLE,
                            "artifact_read_capacity_exceeded",
                        )
                    })?;
                tokio::task::spawn_blocking(move || {
                    let _permit = permit;
                    read_result(root, &path, &hash)
                })
                .await
                .map_err(|_| {
                    ApiError::detail(StatusCode::SERVICE_UNAVAILABLE, "result_unavailable")
                })??
            }
            _ => Value::Null,
        };
    }
    Ok(Json(result))
}

// Completed result reads preserve the immutable worker checksum and never accept a DB path outside artifact_root.
fn read_result(root: PathBuf, relative: &str, expected: &str) -> Result<Value, ApiError> {
    let invalid = || ApiError::detail(StatusCode::SERVICE_UNAVAILABLE, "result_untrusted");
    let path = std::path::Path::new(relative);
    if path.is_absolute()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(invalid());
    }
    let root = root.canonicalize().map_err(|_| invalid())?;
    let mut current = root.clone();
    for component in path.components() {
        let component_text = component.as_os_str().to_string_lossy();
        let stem = component_text
            .split('.')
            .next()
            .unwrap_or("")
            .to_uppercase();
        if component_text.is_empty()
            || component_text
                .chars()
                .any(|c| c.is_control() || c == ':' || c == '\\' || c == '/')
            || component_text.ends_with(['.', ' '])
            || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (1..=9).any(|n| stem == format!("COM{n}") || stem == format!("LPT{n}"))
        {
            return Err(invalid());
        }
        current.push(component);
        let metadata = std::fs::symlink_metadata(&current).map_err(|_| invalid())?;
        if metadata.file_type().is_symlink() {
            return Err(invalid());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(invalid());
            }
        }
    }
    let resolved = current.canonicalize().map_err(|_| invalid())?;
    if !resolved.starts_with(&root) || resolved == root {
        return Err(invalid());
    }
    let metadata = std::fs::metadata(&resolved).map_err(|_| invalid())?;
    if !metadata.is_file() || metadata.len() > 64 * 1024 * 1024 {
        return Err(invalid());
    }
    let mut bytes = Vec::new();
    std::fs::File::open(resolved)
        .map_err(|_| invalid())?
        .take(64 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid())?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err(invalid());
    }
    if format!("{:x}", Sha256::digest(&bytes)) != expected {
        return Err(invalid());
    }
    serde_json::from_slice(&bytes).map_err(|_| invalid())
}

async fn checkpoint(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let row=conn.query_opt("SELECT checkpoint_json,progress_json,attempt_no,status,updated_at_utc FROM research_jobs WHERE workspace_id=$1 AND job_id=$2",&[&scope.workspace_id,&id]).await.map_err(|_|ApiError::database())?
        .ok_or_else(||ApiError::detail(StatusCode::NOT_FOUND,"job_not_found"))?;
    let checkpoint: Option<Value> = row.get("checkpoint_json");
    let checkpoint = checkpoint
        .ok_or_else(|| ApiError::detail(StatusCode::NOT_FOUND, "checkpoint_not_found"))?;
    let progress: Option<Value> = row.get("progress_json");
    let (checkpoint, progress) = validate_checkpoint(checkpoint, progress)
        .map_err(|_| ApiError::detail(StatusCode::SERVICE_UNAVAILABLE, "checkpoint_untrusted"))?;
    Ok(Json(
        json!({"schema_version":"research-job-checkpoint-view-v1","job_id":id,"workspace_id":scope.workspace_id,"execution_capability":false,
        "checkpoint":checkpoint,"progress":progress,"current_attempt_no":row.get::<_,i32>("attempt_no"),"status":row.get::<_,String>("status"),"updated_at_utc":row.get::<_,String>("updated_at_utc")}),
    ))
}

fn forbidden(value: &Value) -> bool {
    match value {
        Value::Object(object) => object.iter().any(|(key, value)| {
            matches!(
                key.as_str(),
                "lease_owner"
                    | "lease_token"
                    | "lease_expires_at_utc"
                    | "provider_credentials"
                    | "broker_state"
                    | "holdout_data"
                    | "resume_command"
            ) || forbidden(value)
        }),
        Value::Array(items) => items.iter().any(forbidden),
        _ => false,
    }
}

fn validate_checkpoint(
    checkpoint: Value,
    progress: Option<Value>,
) -> Result<(Value, Option<Value>), ()> {
    const FIELDS: &[&str] = &[
        "schema",
        "phase",
        "attempt_no",
        "dataset_id",
        "protocol_sha256",
        "validation_schema",
        "trial_outcomes",
        "trial_status_counts",
        "trial_count",
        "fully_accounted",
        "row_count",
        "trade_count",
        "result_sha256",
        "from_utc",
        "to_utc",
        "holdout_access",
        "fold_count",
        "sweep_truncated",
        "stress_config_sha256",
        "stress_scenario_count",
    ];
    let object = checkpoint.as_object().ok_or(())?;
    if forbidden(&checkpoint)
        || progress.as_ref().is_some_and(forbidden)
        || object.get("schema").and_then(Value::as_str) != Some("research-job-checkpoint-v1")
        || object
            .get("phase")
            .and_then(Value::as_str)
            .is_none_or(|v| v.trim().is_empty())
        || object.get("attempt_no").and_then(Value::as_u64).is_none()
    {
        return Err(());
    }
    let mut projected: Map<String, Value> = FIELDS
        .iter()
        .filter_map(|key| object.get(*key).map(|value| ((*key).into(), value.clone())))
        .collect();
    if let Some(outcomes) = projected.get("trial_outcomes").filter(|v| !v.is_null()) {
        let outcomes = outcomes
            .as_array()
            .ok_or(())?
            .iter()
            .map(|outcome| {
                let id = outcome
                    .get("trial_id")
                    .and_then(Value::as_str)
                    .filter(|v| !v.trim().is_empty())
                    .ok_or(())?;
                let status = outcome
                    .get("status")
                    .and_then(Value::as_str)
                    .filter(|v| matches!(*v, "completed" | "failed" | "canceled"))
                    .ok_or(())?;
                Ok(json!({"trial_id":id,"status":status}))
            })
            .collect::<Result<Vec<_>, ()>>()?;
        projected.insert("trial_outcomes".into(), json!(outcomes));
    }
    if projected
        .get("holdout_access")
        .is_some_and(|v| v != &Value::Bool(false))
    {
        return Err(());
    }
    if let Some(counts) = projected
        .get("trial_status_counts")
        .filter(|v| !v.is_null())
        && counts.as_object().ok_or(())?.iter().any(|(key, value)| {
            !matches!(key.as_str(), "canceled" | "completed" | "failed") || value.as_u64().is_none()
        })
    {
        return Err(());
    }
    let progress = if let Some(progress) = progress {
        let object = progress.as_object().ok_or(())?;
        let fields = ["phase_index", "phase_count", "trial_index", "trial_count"];
        if fields
            .iter()
            .any(|key| object.get(*key).is_some_and(|v| v.as_u64().is_none()))
        {
            return Err(());
        }
        for (index, count) in [
            ("phase_index", "phase_count"),
            ("trial_index", "trial_count"),
        ] {
            if let (Some(index), Some(count)) = (
                object.get(index).and_then(Value::as_u64),
                object.get(count).and_then(Value::as_u64),
            ) && index > count
            {
                return Err(());
            }
        }
        Some(Value::Object(
            fields
                .iter()
                .filter_map(|key| object.get(*key).map(|value| ((*key).into(), value.clone())))
                .collect(),
        ))
    } else {
        None
    };
    Ok((Value::Object(projected), progress))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn checkpoint_projects_and_fails_closed() {
        let valid = json!({"schema":"research-job-checkpoint-v1","phase":"read","attempt_no":0,"future":"ignored","holdout_access":false,"trial_outcomes":[{"trial_id":"t","status":"completed","other":"ignored"}]});
        let (view, progress) = validate_checkpoint(
            valid.clone(),
            Some(json!({"phase_index":1,"phase_count":2,"future":true})),
        )
        .unwrap();
        assert!(view.get("future").is_none());
        assert_eq!(
            view["trial_outcomes"][0],
            json!({"trial_id":"t","status":"completed"})
        );
        assert_eq!(progress.unwrap(), json!({"phase_index":1,"phase_count":2}));
        let mut bad = valid.clone();
        bad["future"] = json!({"nested":{"lease_token":"secret"}});
        assert!(validate_checkpoint(bad, None).is_err());
        let mut bad = valid.clone();
        bad["attempt_no"] = json!(true);
        assert!(validate_checkpoint(bad, None).is_err());
        let mut bad = valid.clone();
        bad["holdout_access"] = json!(true);
        assert!(validate_checkpoint(bad, None).is_err());
        assert!(
            validate_checkpoint(
                valid.clone(),
                Some(json!({"phase_index":3,"phase_count":2}))
            )
            .is_err()
        );
        assert!(validate_checkpoint(valid, Some(json!({"trial_count":-1}))).is_err());
    }
    #[test]
    fn result_checksum_and_path_boundary() {
        let root = std::env::temp_dir().join(format!("research-result-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let bytes = b"{\"metrics\":{}}";
        std::fs::write(root.join("result.json"), bytes).unwrap();
        let hash = format!("{:x}", Sha256::digest(bytes));
        assert_eq!(
            read_result(root.clone(), "result.json", &hash).unwrap(),
            json!({"metrics":{}})
        );
        assert!(read_result(root.clone(), "../result.json", &hash).is_err());
        assert!(read_result(root.clone(), "result.json", "wrong").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
