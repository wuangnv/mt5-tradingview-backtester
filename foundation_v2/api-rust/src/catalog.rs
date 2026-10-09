use crate::{
    auth::{ApiError, Workspace},
    state::AppState,
};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
};
use bigdecimal::BigDecimal;
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    str::FromStr,
    sync::{Arc, LazyLock},
};
use tokio_postgres::Row;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/v2/replay/sessions", get(replay_sessions))
        .route("/api/v2/prop/sessions", get(prop_sessions))
        .route("/api/v2/prop/sessions/{session_id}", get(prop_session))
        .route(
            "/api/v2/prop/sessions/{session_id}/attempts",
            get(prop_attempts),
        )
        .route(
            "/api/v2/prop/sessions/{session_id}/attempts/{attempt_id}",
            get(prop_attempt),
        )
        .route("/api/v2/playbooks", get(playbooks))
        .route("/api/v2/playbooks/{record_id}", get(playbook))
        .route(
            "/api/v2/playbooks/{record_id}/revisions",
            get(playbook_revisions),
        )
        .route("/api/v2/journal", get(journals))
        .route("/api/v2/journal/{record_id}", get(journal))
        .route(
            "/api/v2/journal/{record_id}/revisions",
            get(journal_revisions),
        )
        .route("/api/v2/chart/annotations", get(annotations))
        .route(
            "/api/v2/execution/capabilities",
            get(execution_capabilities),
        )
        .route("/api/v2/execution/intents", post(execution_intent))
        .route("/api/v2/session/status", get(session_status))
}

const RECORD_SELECT: &str = "SELECT r.record_id,r.source_key,r.current_revision,r.created_at_utc,r.updated_at_utc,v.payload_json,v.deleted FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=r.current_revision";

fn record_json(row: &Row) -> Value {
    json!({"record_id":row.get::<_,String>("record_id"), "source_key":row.get::<_,Option<String>>("source_key"), "revision":row.get::<_,i32>("current_revision"), "payload":row.get::<_,Value>("payload_json"), "deleted":row.get::<_,bool>("deleted"), "created_at_utc":row.get::<_,String>("created_at_utc"), "updated_at_utc":row.get::<_,String>("updated_at_utc")})
}

async fn list_records(
    state: &AppState,
    scope: &Workspace,
    kind: &str,
) -> Result<Json<Value>, ApiError> {
    let client = state.pool.get().await.map_err(|_| ApiError::database())?;
    let sql = format!(
        "{RECORD_SELECT} WHERE r.workspace_id=$1 AND r.kind=$2 AND NOT v.deleted ORDER BY r.updated_at_utc DESC,r.record_id"
    );
    let rows = client
        .query(&sql, &[&scope.workspace_id, &kind])
        .await
        .map_err(|_| ApiError::database())?;
    Ok(Json(
        json!({"items":rows.iter().map(record_json).collect::<Vec<_>>()}),
    ))
}

async fn get_record(
    state: &AppState,
    scope: &Workspace,
    kind: &str,
    id: &str,
) -> Result<Json<Value>, ApiError> {
    let client = state.pool.get().await.map_err(|_| ApiError::database())?;
    let sql = format!("{RECORD_SELECT} WHERE r.workspace_id=$1 AND r.kind=$2 AND r.record_id=$3");
    let row = client
        .query_opt(&sql, &[&scope.workspace_id, &kind, &id])
        .await
        .map_err(|_| ApiError::database())?
        .ok_or_else(|| ApiError::detail(StatusCode::NOT_FOUND, &format!("{kind}_not_found")))?;
    // Individual journal/playbook reads expose tombstones, just like the canonical store.
    Ok(Json(record_json(&row)))
}

async fn revisions(
    state: &AppState,
    scope: &Workspace,
    kind: &str,
    id: &str,
) -> Result<Json<Value>, ApiError> {
    let client = state.pool.get().await.map_err(|_| ApiError::database())?;
    // A left join distinguishes an absent record from a record without revisions in one read.
    let rows=client.query("SELECT v.revision,v.payload_json,v.deleted,v.created_at_utc FROM workspace_records r LEFT JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id WHERE r.workspace_id=$1 AND r.kind=$2 AND r.record_id=$3 ORDER BY v.revision", &[&scope.workspace_id,&kind,&id]).await.map_err(|_|ApiError::database())?;
    if rows.is_empty() {
        return Err(ApiError::detail(
            StatusCode::NOT_FOUND,
            &format!("{kind}_not_found"),
        ));
    }
    let items=rows.iter().filter(|r|r.get::<_,Option<i32>>("revision").is_some()).map(|r|json!({"revision":r.get::<_,i32>("revision"),"payload":r.get::<_,Value>("payload_json"),"deleted":r.get::<_,bool>("deleted"),"created_at_utc":r.get::<_,String>("created_at_utc")})).collect::<Vec<_>>();
    Ok(Json(json!({"items":items})))
}

macro_rules! record_handlers {
    ($list:ident,$one:ident,$history:ident,$kind:literal) => {
        async fn $list(
            State(state): State<Arc<AppState>>,
            scope: Workspace,
        ) -> Result<Json<Value>, ApiError> {
            list_records(&state, &scope, $kind).await
        }
        async fn $one(
            State(state): State<Arc<AppState>>,
            scope: Workspace,
            Path(id): Path<String>,
        ) -> Result<Json<Value>, ApiError> {
            get_record(&state, &scope, $kind, &id).await
        }
        async fn $history(
            State(state): State<Arc<AppState>>,
            scope: Workspace,
            Path(id): Path<String>,
        ) -> Result<Json<Value>, ApiError> {
            revisions(&state, &scope, $kind, &id).await
        }
    };
}
record_handlers!(playbooks, playbook, playbook_revisions, "playbook");
record_handlers!(journals, journal, journal_revisions, "journal");
async fn annotations(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
) -> Result<Json<Value>, ApiError> {
    list_records(&state, &scope, "annotation").await
}

async fn prop_sessions(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
) -> Result<Json<Value>, ApiError> {
    let client = state.pool.get().await.map_err(|_| ApiError::database())?;
    let rows=client.query("SELECT snapshot_json,session_id FROM prop_sessions WHERE workspace_id=$1 ORDER BY updated_at_utc DESC,session_id",&[&scope.workspace_id]).await.map_err(|_|ApiError::database())?;
    let items = rows
        .iter()
        .map(|r| {
            validated_prop(
                r.get(0),
                PropKind::Session,
                &scope.workspace_id,
                &r.get::<_, String>(1),
                None,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(json!({"items":items})))
}
async fn prop_session(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let client = state.pool.get().await.map_err(|_| ApiError::database())?;
    let row = client
        .query_opt(
            "SELECT snapshot_json FROM prop_sessions WHERE workspace_id=$1 AND session_id=$2",
            &[&scope.workspace_id, &id],
        )
        .await
        .map_err(|_| ApiError::database())?
        .ok_or_else(|| ApiError::detail(StatusCode::NOT_FOUND, "prop_session_not_found"))?;
    Ok(Json(validated_prop(
        row.get(0),
        PropKind::Session,
        &scope.workspace_id,
        &id,
        None,
    )?))
}
async fn prop_attempts(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let client = state.pool.get().await.map_err(|_| ApiError::database())?;
    let rows=client.query("SELECT a.snapshot_json,a.attempt_id,s.snapshot_json AS session_json FROM prop_sessions s LEFT JOIN prop_attempts a ON a.workspace_id=s.workspace_id AND a.session_id=s.session_id WHERE s.workspace_id=$1 AND s.session_id=$2 ORDER BY a.created_at_utc,a.attempt_id",&[&scope.workspace_id,&id]).await.map_err(|_|ApiError::database())?;
    if rows.is_empty() {
        return Err(ApiError::detail(
            StatusCode::NOT_FOUND,
            "prop_session_not_found",
        ));
    }
    validated_prop(
        rows[0].get("session_json"),
        PropKind::Session,
        &scope.workspace_id,
        &id,
        None,
    )?;
    let mut items = Vec::new();
    for row in rows {
        if let Some(raw) = row.get::<_, Option<Value>>(0) {
            items.push(validated_prop(
                raw,
                PropKind::Attempt,
                &scope.workspace_id,
                &id,
                row.get::<_, Option<String>>(1).as_deref(),
            )?);
        }
    }
    Ok(Json(json!({"items":items})))
}
async fn prop_attempt(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Path((session, attempt)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let client = state.pool.get().await.map_err(|_| ApiError::database())?;
    let row=client.query_opt("SELECT s.snapshot_json AS session_json,a.snapshot_json AS attempt_json,a.phase_json,a.resume_json FROM prop_sessions s JOIN prop_attempts a ON a.workspace_id=s.workspace_id AND a.session_id=s.session_id WHERE s.workspace_id=$1 AND s.session_id=$2 AND a.attempt_id=$3",&[&scope.workspace_id,&session,&attempt]).await.map_err(|_|ApiError::database())?.ok_or_else(||ApiError::detail(StatusCode::NOT_FOUND,"prop_attempt_not_found"))?;
    let session_value = validated_prop(
        row.get("session_json"),
        PropKind::Session,
        &scope.workspace_id,
        &session,
        None,
    )?;
    let attempt_value = validated_prop(
        row.get("attempt_json"),
        PropKind::Attempt,
        &scope.workspace_id,
        &session,
        Some(&attempt),
    )?;
    let phase_value = validated_prop(
        row.get("phase_json"),
        PropKind::Phase,
        &scope.workspace_id,
        &session,
        Some(&attempt),
    )?;
    if attempt_value["profile_hash"] != session_value["profile"]["profile_hash"]
        || phase_value["profile_hash"] != attempt_value["profile_hash"]
    {
        return Err(prop_untrusted());
    }
    Ok(Json(
        json!({"session":session_value,"attempt":attempt_value,"phase":phase_value,"resume_state":row.get::<_,Value>("resume_json")}),
    ))
}

#[derive(Clone, Copy)]
enum PropKind {
    Session,
    Attempt,
    Phase,
}
static PROP_SCHEMAS: LazyLock<[(Value, jsonschema::Validator); 3]> = LazyLock::new(|| {
    [
        include_str!("../contracts/prop-session.schema.json"),
        include_str!("../contracts/prop-attempt.schema.json"),
        include_str!("../contracts/prop-phase.schema.json"),
    ]
    .map(|raw| {
        let mut schema: Value = serde_json::from_str(raw).expect("generated prop schema JSON");
        // Pydantic accepts exponent notation for Decimal despite its emitted regex.
        fn decimal_patterns(node: &mut Value) {
            match node {
                Value::Object(map) => {
                    if map
                        .get("pattern")
                        .and_then(Value::as_str)
                        .is_some_and(|p| p.starts_with("^(?!^[-+.]*$)"))
                    {
                        map.remove("pattern");
                    }
                    for v in map.values_mut() {
                        decimal_patterns(v);
                    }
                }
                Value::Array(items) => {
                    for v in items {
                        decimal_patterns(v);
                    }
                }
                _ => {}
            }
        }
        decimal_patterns(&mut schema);
        let validator = jsonschema::draft202012::options()
            .should_validate_formats(true)
            .with_format("time", |raw| {
                chrono::NaiveTime::parse_from_str(raw, "%H:%M:%S%.f").is_ok()
                    || DateTime::parse_from_rfc3339(&format!("1970-01-01T{raw}")).is_ok()
            })
            .build(&schema)
            .expect("generated prop schema compiles");
        (schema, validator)
    })
});
static IANA_TIMEZONES: LazyLock<Vec<String>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../contracts/iana-timezones.json"))
        .expect("exported IANA zones")
});
fn prop_untrusted() -> ApiError {
    ApiError::detail(StatusCode::SERVICE_UNAVAILABLE, "stored_contract_untrusted")
}
fn money(value: &Value) -> Result<BigDecimal, ApiError> {
    let raw = match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => return Err(prop_untrusted()),
    };
    BigDecimal::from_str(&raw).map_err(|_| prop_untrusted())
}
fn prop_defaults(value: &mut Value, node: &Value, root: &Value) -> Result<(), ApiError> {
    if let Some(reference) = node["$ref"].as_str() {
        return prop_defaults(
            value,
            root.pointer(reference.strip_prefix('#').ok_or_else(prop_untrusted)?)
                .ok_or_else(prop_untrusted)?,
            root,
        );
    }
    if let Some(properties) = node["properties"].as_object()
        && let Some(object) = value.as_object_mut()
    {
        for (name, schema) in properties {
            if !object.contains_key(name)
                && let Some(default) = schema.get("default")
            {
                object.insert(name.clone(), default.clone());
            }
            if let Some(field) = object.get_mut(name) {
                prop_defaults(field, schema, root)?;
            }
        }
    }
    if let Some(items) = value.as_array_mut()
        && let Some(schema) = node.get("items")
    {
        for item in items {
            prop_defaults(item, schema, root)?;
        }
    }
    if node["type"] == "integer" && !value.is_null() && value.as_i64().is_none() {
        return Err(prop_untrusted());
    }
    if let Some(branches) = node["anyOf"].as_array() {
        if branches.iter().any(|b| b["type"] == "number")
            && branches.iter().any(|b| b["type"] == "string")
            && !value.is_null()
        {
            let decimal = money(value)?;
            for branch in branches {
                if let Some(min) = branch.get("minimum")
                    && decimal < money(min)?
                {
                    return Err(prop_untrusted());
                }
                if let Some(min) = branch.get("exclusiveMinimum")
                    && decimal <= money(min)?
                {
                    return Err(prop_untrusted());
                }
            }
            if value.is_number() {
                *value = Value::String(value.to_string());
            }
        } else if !value.is_null()
            && let Some(branch) = branches.iter().find(|b| b["type"] != "null")
        {
            prop_defaults(value, branch, root)?;
        }
    }
    Ok(())
}
fn validated_prop(
    mut value: Value,
    kind: PropKind,
    workspace: &str,
    session: &str,
    attempt: Option<&str>,
) -> Result<Value, ApiError> {
    let index = match kind {
        PropKind::Session => 0,
        PropKind::Attempt => 1,
        PropKind::Phase => 2,
    };
    let (schema, validator) = &PROP_SCHEMAS[index];
    prop_defaults(&mut value, schema, schema)?;
    if !validator.is_valid(&value)
        || value["workspace_id"] != workspace
        || value["session_id"] != session
        || attempt.is_some_and(|id| value["attempt_id"] != id)
    {
        return Err(prop_untrusted());
    }
    match kind {
        PropKind::Session => {
            let profile = &value["profile"];
            if profile["source_kind"] == "named_provider"
                && profile["source_url"].as_str().is_none_or(str::is_empty)
            {
                return Err(prop_untrusted());
            }
            let mut currency = None;
            for (i, phase) in profile["phases"]
                .as_array()
                .ok_or_else(prop_untrusted)?
                .iter()
                .enumerate()
            {
                let current = phase["currency"]
                    .as_str()
                    .ok_or_else(prop_untrusted)?
                    .to_uppercase();
                if !IANA_TIMEZONES
                    .iter()
                    .any(|zone| phase["reset_timezone"] == zone.as_str())
                {
                    return Err(prop_untrusted());
                }
                if phase["phase_index"].as_u64() != Some(i as u64 + 1)
                    || currency.as_ref().is_some_and(|c| c != &current)
                {
                    return Err(prop_untrusted());
                }
                currency = Some(current);
                for name in ["profit_target", "daily_loss", "overall_drawdown"] {
                    let threshold = &phase[name]["threshold"];
                    if threshold["amount"].is_null() == threshold["percent"].is_null() {
                        return Err(prop_untrusted());
                    }
                }
                let drawdown = &phase["overall_drawdown"];
                if (drawdown["kind"] == "trailing" && drawdown["trailing_granularity"].is_null())
                    || (drawdown["kind"] == "static" && !drawdown["trailing_granularity"].is_null())
                {
                    return Err(prop_untrusted());
                }
            }
        }
        PropKind::Attempt => {
            let start = DateTime::parse_from_rfc3339(
                value["virtual_start_utc"]
                    .as_str()
                    .ok_or_else(prop_untrusted)?,
            )
            .map_err(|_| prop_untrusted())?;
            let end = DateTime::parse_from_rfc3339(
                value["virtual_cutoff_utc"]
                    .as_str()
                    .ok_or_else(prop_untrusted)?,
            )
            .map_err(|_| prop_untrusted())?;
            if end < start {
                return Err(prop_untrusted());
            }
        }
        PropKind::Phase => {
            if money(&value["equity"])? != money(&value["balance"])? + money(&value["floating_pl"])?
            {
                return Err(prop_untrusted());
            }
        }
    }
    Ok(value)
}

fn untrusted() -> ApiError {
    ApiError::detail(StatusCode::SERVICE_UNAVAILABLE, "replay_catalog_untrusted")
}
fn text(value: &Value, min: usize, max: usize) -> Result<(), ApiError> {
    let s = value.as_str().ok_or_else(untrusted)?;
    if !(min..=max).contains(&s.chars().count()) {
        return Err(untrusted());
    }
    Ok(())
}
fn integer(value: &Value, min: i64) -> Result<(), ApiError> {
    if value.as_i64().is_none_or(|v| v < min) {
        Err(untrusted())
    } else {
        Ok(())
    }
}
fn optional_text(value: &Value, max: usize) -> Result<(), ApiError> {
    if value.is_null() {
        Ok(())
    } else {
        text(value, 1, max)
    }
}

fn replay_catalog_item(
    record: &Value,
    manifests: &HashMap<String, Value>,
) -> Result<Value, ApiError> {
    let payload = record["payload"].as_object().ok_or_else(untrusted)?;
    let field = |name: &str, default: Value| payload.get(name).cloned().unwrap_or(default);
    let dataset_id = field("dataset_id", Value::Null);
    optional_text(&dataset_id, 256)?;
    let dataset_ids = field(
        "dataset_ids",
        dataset_id.as_str().map(|v| json!([v])).unwrap_or(json!([])),
    );
    let keys = dataset_ids.as_array().ok_or_else(untrusted)?;
    for key in keys {
        if !key.is_string() {
            return Err(untrusted());
        }
    }
    let manifest = dataset_id.as_str().and_then(|id| manifests.get(id));
    let selected = keys
        .iter()
        .map(|key| manifests.get(key.as_str().unwrap()))
        .collect::<Vec<_>>();
    let mut item = Map::new();
    for name in ["record_id", "revision", "created_at_utc", "updated_at_utc"] {
        item.insert(name.into(), record[name].clone());
    }
    for (name, default) in [
        ("name", json!("")),
        ("description", json!("")),
        ("archived", json!(false)),
        ("cursor_index", json!(0)),
        ("status", json!("unknown")),
        ("branch_id", Value::Null),
        ("parent_session_id", Value::Null),
        ("parent_revision", Value::Null),
    ] {
        item.insert(name.into(), field(name, default));
    }
    // Pydantic's non-strict boolean accepts its documented textual/numeric values.
    let archived = match &item["archived"] {
        Value::Bool(v) => *v,
        Value::Number(n) if n.as_i64() == Some(0) => false,
        Value::Number(n) if n.as_i64() == Some(1) => true,
        Value::String(s) => match s.to_ascii_lowercase().as_str() {
            "false" | "f" | "no" | "n" | "off" | "0" => false,
            "true" | "t" | "yes" | "y" | "on" | "1" => true,
            _ => return Err(untrusted()),
        },
        _ => return Err(untrusted()),
    };
    item.insert("archived".into(), json!(archived));
    item.insert("dataset_id".into(), dataset_id);
    item.insert("dataset_ids".into(), dataset_ids);
    let instrument_ids = selected
        .iter()
        .flatten()
        .map(|m| m["instrument_id"].clone())
        .collect::<Vec<_>>();
    if instrument_ids.iter().any(|v| !v.is_string()) {
        return Err(untrusted());
    }
    item.insert("instrument_ids".into(), json!(instrument_ids));
    for name in [
        "instrument_id",
        "timeframe",
        "timeframe_seconds",
        "row_count",
    ] {
        item.insert(
            name.into(),
            manifest.map(|m| m[name].clone()).unwrap_or(Value::Null),
        );
    }
    item.insert(
        "dataset_available".into(),
        json!(!selected.is_empty() && selected.iter().all(|m| m.is_some())),
    );
    item.insert("has_execution".into(), record["has_execution"].clone());
    text(&item["record_id"], 1, 128)?;
    text(&item["name"], 0, 160)?;
    text(&item["description"], 0, 2000)?;
    integer(&item["revision"], 1)?;
    integer(&item["cursor_index"], 0)?;
    text(&item["status"], 1, 32)?;
    optional_text(&item["instrument_id"], 128)?;
    optional_text(&item["timeframe"], 32)?;
    optional_text(&item["branch_id"], 128)?;
    optional_text(&item["parent_session_id"], 128)?;
    for (name, min) in [
        ("parent_revision", 1),
        ("timeframe_seconds", 1),
        ("row_count", 2),
    ] {
        if !item[name].is_null() {
            integer(&item[name], min)?;
        }
    }
    text(&item["created_at_utc"], 1, 64)?;
    text(&item["updated_at_utc"], 1, 64)?;
    Ok(Value::Object(item))
}

async fn replay_sessions(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
) -> Result<Json<Value>, ApiError> {
    let client = state.pool.get().await.map_err(|_| ApiError::database())?;
    // Exclude execution ledgers and per-asset ledgers from the catalog payload transfer.
    let rows=client.query("SELECT r.record_id,r.current_revision,r.created_at_utc,r.updated_at_utc,jsonb_typeof(v.payload_json)='object' AS valid_payload,CASE WHEN jsonb_typeof(v.payload_json)='object' THEN v.payload_json-'execution'-'asset_states' ELSE '{}'::jsonb END AS payload_json,((v.payload_json->'execution' IS NOT NULL AND v.payload_json->'execution'<>'null'::jsonb) OR CASE WHEN jsonb_typeof(v.payload_json->'asset_states')='object' THEN EXISTS(SELECT 1 FROM jsonb_each(v.payload_json->'asset_states') s WHERE s.value->'execution' IS NOT NULL AND s.value->'execution' NOT IN ('null'::jsonb,'false'::jsonb,'0'::jsonb,'\"\"'::jsonb,'[]'::jsonb,'{}'::jsonb)) ELSE false END) AS has_execution FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=r.current_revision WHERE r.workspace_id=$1 AND r.kind='replay' AND NOT v.deleted ORDER BY r.updated_at_utc DESC,r.record_id",&[&scope.workspace_id]).await.map_err(|_|ApiError::database())?;
    let mut records = Vec::with_capacity(rows.len());
    let mut ids = Vec::new();
    for row in rows {
        if !row.get::<_, bool>("valid_payload") {
            return Err(untrusted());
        }
        let payload: Value = row.get("payload_json");
        if let Some(id) = payload["dataset_id"].as_str() {
            ids.push(id.to_owned());
        }
        if let Some(keys) = payload["dataset_ids"].as_array() {
            for key in keys {
                if let Some(id) = key.as_str() {
                    ids.push(id.to_owned());
                }
            }
        }
        records.push(json!({"record_id":row.get::<_,String>("record_id"),"revision":row.get::<_,i32>("current_revision"),"created_at_utc":row.get::<_,String>("created_at_utc"),"updated_at_utc":row.get::<_,String>("updated_at_utc"),"payload":payload,"has_execution":row.get::<_,bool>("has_execution")}));
    }
    ids.sort();
    ids.dedup();
    let mut manifests = HashMap::new();
    if !ids.is_empty() {
        for row in client.query("SELECT dataset_id,manifest_json FROM datasets WHERE workspace_id=$1 AND dataset_id=ANY($2)",&[&scope.workspace_id,&ids]).await.map_err(|_|ApiError::database())?{manifests.insert(row.get::<_,String>(0),row.get::<_,Value>(1));}
    }
    let items = records
        .iter()
        .map(|r| replay_catalog_item(r, &manifests))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(json!({"items":items})))
}

fn capabilities() -> Value {
    json!({"mode":"locked","preview":false,"place":false,"modify":false,"cancel":false,"close":false,"broker_execution_capability":false,"reason":"F7 foundation software slice has no broker execution authority"})
}
async fn execution_capabilities(_scope: Workspace) -> Json<Value> {
    Json(capabilities())
}
async fn execution_intent(_scope: Workspace) -> Result<Json<Value>, ApiError> {
    Err(ApiError::detail(
        StatusCode::FORBIDDEN,
        "broker_execution_locked",
    ))
}
fn local_status(subject: &str, workspace: &str, now: &str) -> Value {
    let digest = Sha256::digest(format!("{subject}\0{workspace}"));
    let marker = format!("local-demo-session:{}", &format!("{digest:x}")[..24]);
    json!({"schema_version":"project-session-v1","session":{"schema_version":"project-session-v1","auth_mode":"local-trusted-demo","production_auth":false,"session_id":marker,"identity_id":subject,"workspace_id":workspace,"status":"signed_in","issued_at_utc":now,"expires_at_utc":null,"signed_out_at_utc":null,"credentials_present":false},"workspace":{"id":workspace},"identity":{"marker":subject,"source":"local-process"},"auth_mode":"local-trusted-demo","production_auth":false,"credentials_present":false})
}
async fn session_status(scope: Workspace) -> Json<Value> {
    Json(local_status(
        &scope.subject,
        &scope.workspace_id,
        &Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn phase_fixture() -> Value {
        json!({"workspace_id":"tenant-a","session_id":"s","attempt_id":"a","profile_hash":"sha256:test","phase_index":1,"initial_balance":"100000","balance":"100250.00","floating_pl":"-50.00","equity":"100200.00","high_water_mark":"100400","daily_anchor":"100100","virtual_time_utc":"2026-10-09T00:00:00Z","evaluation_quality":"full_for_declared_model"})
    }
    #[test]
    fn prop_corruption_and_wrong_scope_fail_closed() {
        let valid =
            validated_prop(phase_fixture(), PropKind::Phase, "tenant-a", "s", Some("a")).unwrap();
        assert_eq!(valid["balance"], "100250.00");
        assert_eq!(valid["qualifying_days"], 0);
        for (field, value) in [
            ("workspace_id", json!("tenant-b")),
            ("equity", json!("10")),
            ("balance", json!("NaN")),
            ("phase_index", json!(1.0)),
            ("equity", Value::Null),
            ("evaluation_quality", json!("unknown")),
        ] {
            let mut broken = phase_fixture();
            broken[field] = value;
            assert_eq!(
                validated_prop(broken, PropKind::Phase, "tenant-a", "s", Some("a"))
                    .unwrap_err()
                    .0,
                StatusCode::SERVICE_UNAVAILABLE
            );
        }
    }
    #[test]
    fn prop_decimal_exponents_remain_exact_and_timezone_is_required() {
        let mut phase = phase_fixture();
        phase["balance"] = json!("1.0025E+5");
        assert_eq!(
            validated_prop(phase.clone(), PropKind::Phase, "tenant-a", "s", Some("a")).unwrap()["balance"],
            "1.0025E+5"
        );
        phase["virtual_time_utc"] = json!("2026-10-09T00:00:00");
        assert!(validated_prop(phase, PropKind::Phase, "tenant-a", "s", Some("a")).is_err());
    }
    fn record() -> Value {
        json!({"record_id":"replay-1","revision":1,"created_at_utc":"2026-10-09T00:00:00Z","updated_at_utc":"2026-10-09T00:00:00Z","payload":{"dataset_id":"a","dataset_ids":["a","b"],"cursor_index":0},"has_execution":false})
    }
    #[test]
    fn missing_dataset_is_retained_with_null_metadata() {
        let item = replay_catalog_item(&record(), &HashMap::new()).unwrap();
        assert_eq!(item["dataset_available"], false);
        assert_eq!(item["instrument_id"], Value::Null);
        assert_eq!(item["dataset_ids"], json!(["a", "b"]));
        assert_eq!(item.as_object().unwrap().len(), 21);
        assert!(item.get("execution").is_none());
    }
    #[test]
    fn multi_asset_metadata_preserves_order_and_duplicates() {
        let manifests = HashMap::from([
            (
                "a".into(),
                json!({"instrument_id":"EURUSD","timeframe":"M1","timeframe_seconds":60,"row_count":2}),
            ),
            (
                "b".into(),
                json!({"instrument_id":"XAUUSD","timeframe":"M1","timeframe_seconds":60,"row_count":3}),
            ),
        ]);
        let mut raw = record();
        raw["payload"]["dataset_ids"] = json!(["b", "a", "b"]);
        let item = replay_catalog_item(&raw, &manifests).unwrap();
        assert_eq!(item["dataset_available"], true);
        assert_eq!(
            item["instrument_ids"],
            json!(["XAUUSD", "EURUSD", "XAUUSD"])
        );
        assert_eq!(item["instrument_id"], "EURUSD");
    }
    #[test]
    fn corrupt_catalog_fails_closed() {
        for (key, value) in [
            ("cursor_index", json!(-1)),
            ("cursor_index", json!(true)),
            ("status", json!("")),
            ("name", Value::Null),
            ("dataset_id", json!(42)),
            ("dataset_ids", Value::Null),
            ("parent_revision", json!(0)),
        ] {
            let mut raw = record();
            raw["payload"][key] = value;
            assert_eq!(
                replay_catalog_item(&raw, &HashMap::new()).unwrap_err().0,
                StatusCode::SERVICE_UNAVAILABLE
            );
        }
    }
    #[test]
    fn default_single_dataset_and_execution_are_preserved() {
        let mut raw = record();
        raw["payload"]
            .as_object_mut()
            .unwrap()
            .remove("dataset_ids");
        raw["has_execution"] = json!(true);
        let item = replay_catalog_item(&raw, &HashMap::new()).unwrap();
        assert_eq!(item["dataset_ids"], json!(["a"]));
        assert_eq!(item["has_execution"], true);
    }
    #[test]
    fn demo_session_is_stable_scoped_and_has_no_credentials() {
        let a = local_status("local-owner", "tenant-a", "2026-10-09T00:00:00Z");
        let b = local_status("local-owner", "tenant-a", "later");
        let c = local_status("local-owner", "tenant-b", "later");
        assert_eq!(a["session"]["session_id"], b["session"]["session_id"]);
        assert_ne!(a["session"]["session_id"], c["session"]["session_id"]);
        assert_eq!(a["session"]["session_id"].as_str().unwrap().len(), 43);
        assert_eq!(a["session"]["expires_at_utc"], Value::Null);
        assert_eq!(a["production_auth"], false);
        assert_eq!(capabilities()["place"], false);
    }
}
