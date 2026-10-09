use std::{future::IntoFuture, sync::atomic::Ordering};
use trading_workspace_api::{config::Config, state::AppState};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    trading_workspace_api::telemetry::initialize();
    let config = Config::from_environment().map_err(std::io::Error::other)?;
    let state = AppState::connect(config)
        .await
        .map_err(std::io::Error::other)?;
    let app = trading_workspace_api::router(state.clone(), trading_workspace_api::domain_routes());
    let listener = tokio::net::TcpListener::bind(state.config.bind).await?;
    tracing::info!(bind=%state.config.bind,contract_version=trading_workspace_api::CONTRACT_VERSION,"API listening");
    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
    let server = axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = stop_rx.await;
        })
        .into_future();
    tokio::pin!(server);
    tokio::select! {
        result=&mut server => { result?; },
        result=shutdown_signal() => {
            result?;
            state.draining.store(true,Ordering::Release);
            let _=stop_tx.send(());
            tracing::info!("API draining");
            match tokio::time::timeout(state.config.drain_timeout,&mut server).await {
                Ok(result)=>result?,
                Err(_)=>tracing::warn!("drain deadline reached; unfinished requests will be disconnected"),
            }
        }
    }
    state.pool.close();
    Ok(())
}

async fn shutdown_signal() -> std::io::Result<()> {
    let stop_file = async {
        let Some(path) = std::env::var_os("TW_V2_SHUTDOWN_FILE") else {
            std::future::pending::<()>().await;
            return;
        };
        loop {
            if std::path::Path::new(&path).is_file() {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
    };
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
        tokio::select! { result=tokio::signal::ctrl_c()=>result, _=terminate.recv()=>Ok(()), _=stop_file=>Ok(()) }
    }
    #[cfg(not(unix))]
    {
        tokio::select! { result=tokio::signal::ctrl_c()=>result, _=stop_file=>Ok(()) }
    }
}
