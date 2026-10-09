use crate::state::AppState;
use axum::{
    Json,
    extract::FromRequestParts,
    http::{HeaderMap, StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use std::{collections::HashSet, sync::Arc};

#[derive(Clone)]
pub struct LocalAuthorization {
    pub identity: String,
    workspaces: HashSet<String>,
}
#[derive(Clone, Debug)]
pub struct Workspace {
    pub workspace_id: String,
    pub subject: String,
}
#[derive(Debug)]
pub struct ApiError(pub StatusCode, pub Value);
impl ApiError {
    pub fn detail(status: StatusCode, detail: &str) -> Self {
        Self(status, json!({"detail": detail}))
    }
    pub fn database() -> Self {
        Self::detail(StatusCode::SERVICE_UNAVAILABLE, "database_unavailable")
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(self.1)).into_response()
    }
}
impl LocalAuthorization {
    pub fn new(identity: String, workspaces: Vec<String>) -> Self {
        Self {
            identity: identity.trim().into(),
            workspaces: workspaces
                .into_iter()
                .map(|v| v.trim().to_owned())
                .filter(|v| !v.is_empty())
                .collect(),
        }
    }
    pub fn authorize(&self, headers: &HeaderMap) -> Result<Workspace, ApiError> {
        let header = headers.get("x-workspace-id").and_then(|v| v.to_str().ok());
        let Some(raw) = header else {
            return Err(ApiError(
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({"detail":[{"type":"missing","loc":["header","x-workspace-id"],"msg":"Field required","input":null}]}),
            ));
        };
        if raw.is_empty() {
            return Err(ApiError(
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({"detail":[{"type":"string_too_short","loc":["header","x-workspace-id"],"msg":"String should have at least 1 character","input":"","ctx":{"min_length":1}}]}),
            ));
        }
        let workspace_id = raw.trim();
        if workspace_id.is_empty() {
            return Err(ApiError::detail(
                StatusCode::FORBIDDEN,
                "workspace_access_denied",
            ));
        }
        if self.identity.is_empty() {
            return Err(ApiError::detail(
                StatusCode::UNAUTHORIZED,
                "trusted_identity_missing",
            ));
        }
        if !self.workspaces.contains(workspace_id) {
            return Err(ApiError::detail(
                StatusCode::FORBIDDEN,
                "workspace_access_denied",
            ));
        }
        Ok(Workspace {
            workspace_id: workspace_id.into(),
            subject: self.identity.clone(),
        })
    }
    pub fn status(&self) -> Value {
        json!({"mode":"local-trusted-identity","local_only":true,"trusted_identity_configured":!self.identity.is_empty(),"production_auth":false,"oauth_or_idp":false,"database_rls":false})
    }
    pub fn callback_scope(&self, configured: Option<&[String]>) -> Result<Workspace, ApiError> {
        let Some([workspace]) = configured else {
            return Err(ApiError::detail(
                StatusCode::SERVICE_UNAVAILABLE,
                "notion_oauth_callback_workspace_unconfigured",
            ));
        };
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-workspace-id",
            workspace.parse().map_err(|_| {
                ApiError::detail(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "notion_oauth_callback_workspace_unconfigured",
                )
            })?,
        );
        self.authorize(&headers)
    }
}
impl FromRequestParts<Arc<AppState>> for Workspace {
    type Rejection = ApiError;
    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        if let Some(scope) = parts.extensions.get::<Workspace>() {
            return Ok(scope.clone());
        }
        state.authorization.authorize(&parts.headers)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_cannot_choose_identity() {
        let auth = LocalAuthorization::new("owner".into(), vec!["tenant-a".into()]);
        let mut headers = HeaderMap::new();
        headers.insert("x-workspace-id", "tenant-b".parse().unwrap());
        headers.insert("x-user-id", "owner".parse().unwrap());
        assert_eq!(
            auth.authorize(&headers).unwrap_err().0,
            StatusCode::FORBIDDEN
        );
        headers.insert("x-workspace-id", " tenant-a ".parse().unwrap());
        assert_eq!(auth.authorize(&headers).unwrap().workspace_id, "tenant-a");
    }
    #[test]
    fn identity_missing_fails_closed() {
        let mut headers = HeaderMap::new();
        headers.insert("x-workspace-id", "tenant-a".parse().unwrap());
        assert_eq!(
            LocalAuthorization::new("".into(), vec!["tenant-a".into()])
                .authorize(&headers)
                .unwrap_err()
                .0,
            StatusCode::UNAUTHORIZED
        );
    }
}
