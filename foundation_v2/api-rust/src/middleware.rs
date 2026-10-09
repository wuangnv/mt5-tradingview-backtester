use crate::{auth::ApiError, state::AppState};
use axum::{
    extract::{Request, State},
    http::{HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::{
    sync::{Arc, atomic::Ordering},
    time::{Duration, Instant},
};
use uuid::Uuid;

pub async fn boundary(
    State(state): State<Arc<AppState>>,
    mut request: Request,
    next: Next,
) -> Response {
    let started = Instant::now();
    // Generated server-side so arbitrary client text cannot enter logs or override correlation.
    let request_id = Uuid::new_v4().to_string();
    let method = request.method().clone();
    let path = request
        .extensions()
        .get::<axum::extract::MatchedPath>()
        .map(|p| p.as_str().to_owned())
        .unwrap_or_else(|| "unmatched".into());
    let span = tracing::info_span!("http_request", request_id = %request_id, method = %method, route = %path);
    let response = async {
        if request.method() == axum::http::Method::HEAD
            && request.uri().path().starts_with("/api/v2/")
        {
            let mut methods = crate::commands::allowed_methods(&path);
            if methods.is_empty()
                && matches!(
                    path.as_str(),
                    "/api/v2/events" | "/api/v2/commands/{command_id}"
                )
            {
                methods.push("GET".into());
            }
            if !methods.is_empty() {
                let mut response =
                    ApiError::detail(StatusCode::METHOD_NOT_ALLOWED, "Method Not Allowed")
                        .into_response();
                response.headers_mut().insert(
                    "allow",
                    HeaderValue::from_str(&methods.join(", ")).expect("reviewed HTTPmethods"),
                );
                return response;
            }
        }
        if matches!(request.uri().path(), "/health" | "/health/live") {
            return next.run(request).await;
        }
        if state.draining.load(Ordering::Acquire) {
            return ApiError::detail(StatusCode::SERVICE_UNAVAILABLE, "server_draining")
                .into_response();
        }
        let scope = if request.uri().path().starts_with("/api/v2/") {
            // A browser OAuth redirect has no workspace header. The nonce is still checked
            // by the worker; only the configured local single-workspace context is admitted.
            let authorization = if request.method() == axum::http::Method::GET
                && request.uri().path() == "/api/v2/connectors/notion/oauth/callback"
            {
                state
                    .authorization
                    .callback_scope(state.config.local_workspaces.as_deref())
            } else {
                state.authorization.authorize(request.headers())
            };
            match authorization {
                Ok(workspace) => {
                    request.extensions_mut().insert(workspace.clone());
                    Some(workspace.workspace_id)
                }
                Err(error) => return error.into_response(),
            }
        } else {
            None
        };
        if let Some(workspace_id) = scope {
            let admitted = {
                let mut windows = state.rate_windows.lock().unwrap_or_else(|p| p.into_inner());
                let (start, count) = windows.entry(workspace_id).or_insert((Instant::now(), 0));
                if start.elapsed() >= Duration::from_secs(60) {
                    *start = Instant::now();
                    *count = 0;
                }
                if *count >= state.config.requests_per_minute {
                    false
                } else {
                    *count += 1;
                    true
                }
            };
            if !admitted {
                state.telemetry.rejected.fetch_add(1, Ordering::Relaxed);
                let mut response =
                    ApiError::detail(StatusCode::TOO_MANY_REQUESTS, "rate_limit_exceeded")
                        .into_response();
                response
                    .headers_mut()
                    .insert("retry-after", HeaderValue::from_static("60"));
                return response;
            }
        }
        let Ok(_permit) = state.admission.clone().try_acquire_owned() else {
            state.telemetry.rejected.fetch_add(1, Ordering::Relaxed);
            let mut response =
                ApiError::detail(StatusCode::SERVICE_UNAVAILABLE, "request_capacity_exceeded")
                    .into_response();
            response
                .headers_mut()
                .insert("retry-after", HeaderValue::from_static("1"));
            return response;
        };
        match tokio::time::timeout(state.config.request_timeout, next.run(request)).await {
            Ok(response) => response,
            Err(_) => {
                ApiError::detail(StatusCode::GATEWAY_TIMEOUT, "request_timeout").into_response()
            }
        }
    };
    let mut response = tracing::Instrument::instrument(response, span).await;
    if response.status() == StatusCode::PAYLOAD_TOO_LARGE {
        response = ApiError::detail(StatusCode::PAYLOAD_TOO_LARGE, "request_body_too_large")
            .into_response();
    }
    if response.status() == StatusCode::METHOD_NOT_ALLOWED {
        let allow = response.headers().get("allow").cloned();
        response =
            ApiError::detail(StatusCode::METHOD_NOT_ALLOWED, "Method Not Allowed").into_response();
        if let Some(allow) = allow {
            response.headers_mut().insert("allow", allow);
        }
    }
    if path == "/api/v2/connectors/notion/oauth/callback" {
        response.headers_mut().insert(
            "content-security-policy",
            HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'; base-uri 'none'"),
        );
        response
            .headers_mut()
            .insert("referrer-policy", HeaderValue::from_static("no-referrer"));
        response
            .headers_mut()
            .insert("pragma", HeaderValue::from_static("no-cache"));
    }
    let elapsed = started.elapsed().as_micros().min(u64::MAX as u128) as u64;
    state
        .telemetry
        .record(response.status().is_server_error(), elapsed);
    tracing::info!(request_id = %request_id, method = %method, route = %path, status = response.status().as_u16(), elapsed_us = elapsed, "request completed");
    response.headers_mut().insert(
        "x-request-id",
        HeaderValue::from_str(&request_id).expect("UUID header"),
    );
    response.headers_mut().insert(
        "x-contract-version",
        HeaderValue::from_static(crate::CONTRACT_VERSION),
    );
    response.headers_mut().insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    response
        .headers_mut()
        .insert("cache-control", HeaderValue::from_static("no-store"));
    response
}
