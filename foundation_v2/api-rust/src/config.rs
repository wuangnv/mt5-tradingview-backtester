use std::{env, net::SocketAddr, path::PathBuf, time::Duration};

#[derive(Clone)]
pub struct Config {
    pub bind: SocketAddr,
    pub database_url: String,
    pub artifact_root: PathBuf,
    pub pool_size: usize,
    pub pool_timeout: Duration,
    pub request_timeout: Duration,
    pub drain_timeout: Duration,
    pub command_wait_timeout: Duration,
    pub max_concurrency: usize,
    pub max_body_bytes: usize,
    pub requests_per_minute: u32,
    pub local_identity: String,
    pub local_workspaces: Option<Vec<String>>,
    pub metrics_token: Option<String>,
    pub openapi_path: PathBuf,
}

impl Config {
    pub fn from_environment() -> Result<Self, String> {
        let bind = env::var("TW_V2_RUST_BIND")
            .unwrap_or_else(|_| "127.0.0.1:8010".into())
            .parse::<SocketAddr>()
            .map_err(|_| "invalid TW_V2_RUST_BIND")?;
        // Current identity is a local-process owner, never proof of remote caller identity.
        if !bind.ip().is_loopback() {
            return Err(
                "local identity requires a loopback bind; hosted auth is not configured".into(),
            );
        }
        if env::var("TW_V2_AUTH_MODE").is_ok_and(|v| v != "local-trusted-identity") {
            return Err(
                "unsupported authentication mode; hosted authentication fails closed".into(),
            );
        }
        let number = |key, default, min, max| -> Result<usize, String> {
            let value = match env::var(key) {
                Ok(v) => v.parse().map_err(|_| format!("invalid {key}"))?,
                Err(_) => default,
            };
            if !(min..=max).contains(&value) {
                return Err(format!("{key} outside allowed resource budget"));
            }
            Ok(value)
        };
        let metrics_token = env::var("TW_V2_METRICS_TOKEN")
            .ok()
            .filter(|v| !v.is_empty());
        if metrics_token.as_ref().is_some_and(|v| v.len() < 32) {
            return Err("metrics token requires at least 32 characters".into());
        }
        let config = Self {
            bind,
            database_url: env::var("TW_V2_DATABASE_URL")
                .map_err(|_| "TW_V2_DATABASE_URL required")?,
            artifact_root: env::var("TW_V2_ARTIFACT_ROOT")
                .map(PathBuf::from)
                .map_err(|_| "TW_V2_ARTIFACT_ROOT required")?,
            pool_size: number("TW_V2_RUST_POOL_SIZE", 8, 1, 128)?,
            pool_timeout: Duration::from_millis(number(
                "TW_V2_RUST_POOL_TIMEOUT_MS",
                3000,
                1,
                60000,
            )? as u64),
            request_timeout: Duration::from_millis(number(
                "TW_V2_RUST_REQUEST_TIMEOUT_MS",
                30000,
                100,
                300000,
            )? as u64),
            drain_timeout: Duration::from_millis(number(
                "TW_V2_RUST_DRAIN_TIMEOUT_MS",
                35000,
                100,
                300000,
            )? as u64),
            command_wait_timeout: Duration::from_millis(number(
                "TW_V2_RUST_COMMAND_WAIT_TIMEOUT_MS",
                20000,
                100,
                240000,
            )? as u64),
            max_concurrency: number("TW_V2_RUST_MAX_CONCURRENCY", 128, 1, 4096)?,
            max_body_bytes: number(
                "TW_V2_RUST_MAX_BODY_BYTES",
                32 * 1024 * 1024,
                1024,
                32 * 1024 * 1024,
            )?,
            requests_per_minute: number("TW_V2_RUST_REQUESTS_PER_MINUTE", 1200, 1, 100000)? as u32,
            local_identity: env::var("TW_V2_LOCAL_IDENTITY")
                .unwrap_or_else(|_| "local-owner".into())
                .trim()
                .into(),
            local_workspaces: env::var("TW_V2_LOCAL_WORKSPACES").ok().map(|v| {
                v.split(',')
                    .map(str::trim)
                    .filter(|v| !v.is_empty())
                    .map(String::from)
                    .collect()
            }),
            metrics_token,
            openapi_path: env::var("TW_V2_OPENAPI_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|_| {
                    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../contracts/openapi.json")
                }),
        };
        if config.command_wait_timeout + config.pool_timeout * 2 + Duration::from_secs(1)
            >= config.request_timeout
        {
            return Err("command wait + pool budgets must finish before request timeout so command IDs remain recoverable".into());
        }
        Ok(config)
    }
}
