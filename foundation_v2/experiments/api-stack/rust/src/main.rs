use axum::{Router, Json, routing::get, extract::{State, Query}, http::{HeaderMap, StatusCode}, response::IntoResponse};
use serde::{Serialize, Deserialize};
use serde_json::json;
use std::sync::Arc;
use deadpool_postgres::{Manager, Pool};
use tokio_postgres::NoTls;

#[derive(Clone, Serialize)]
struct Trade {id: i32, symbol: String, pnl_cents: i32}
struct App {data: Vec<Trade>, pool: Pool, sql: String}
#[derive(Deserialize)]
struct Params {rows: Option<i32>, page: Option<i32>}
type Failure = (StatusCode, Json<serde_json::Value>);
fn scope(headers: &HeaderMap) -> Result<(), Failure> {
    if headers.get("x-workspace-id").and_then(|v| v.to_str().ok()) != Some("tenant-a") {
        return Err((StatusCode::FORBIDDEN, Json(json!({"detail":"workspace_access_denied"}))));
    }
    Ok(())
}
fn params(p: Params) -> Result<(i32,i32), Failure> {
    let (rows,page)=(p.rows.unwrap_or(100000),p.page.unwrap_or(1));
    if ![10000,100000].contains(&rows) || !(1..=100).contains(&page) {
        return Err((StatusCode::BAD_REQUEST,Json(json!({"detail":"parameters_invalid"}))));
    }
    Ok((rows,page))
}
async fn small(headers: HeaderMap) -> Result<impl IntoResponse, Failure> {
    scope(&headers)?; Ok(Json(json!({"ok":true,"scope":"tenant-a"})))
}
async fn trades(State(state): State<Arc<App>>, headers: HeaderMap, Query(p): Query<Params>) -> Result<impl IntoResponse, Failure> {
    scope(&headers)?; let (rows,page)=params(p)?;
    let mut selected: Vec<&Trade> = state.data.iter().filter(|t| t.id<=rows && t.symbol=="EURUSD").collect();
    selected.sort_by_key(|t| (-t.pnl_cents,t.id));
    let items: Vec<&Trade> = selected.iter().skip(((page-1)*25) as usize).take(25).copied().collect();
    Ok(Json(json!({"total":selected.len(),"items":items})))
}
async fn database(State(state): State<Arc<App>>, headers: HeaderMap, Query(p): Query<Params>) -> Result<impl IntoResponse, Failure> {
    scope(&headers)?; let (rows,page)=params(p)?;
    let sql=state.sql.replace("{rows}",&rows.to_string()).replace("{offset}",&((page-1)*25).to_string());
    let client=state.pool.get().await.map_err(|_| (StatusCode::SERVICE_UNAVAILABLE,Json(json!({"detail":"pool_error"}))))?;
    let result=client.query(&sql,&[]).await.map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR,Json(json!({"detail":"db_error"}))))?;
    let total: i64=result.first().map(|r|r.get(3)).unwrap_or(0);
    let items: Vec<Trade>=result.iter().filter_map(|r| r.get::<_,Option<i32>>(0).map(|id| Trade{id,symbol:r.get(1),pnl_cents:r.get(2)})).collect();
    Ok(Json(json!({"total":total,"items":items})))
}
#[tokio::main(worker_threads=4)]
async fn main() {
    let db: tokio_postgres::Config=format!("host=127.0.0.1 port={} user=bench dbname=postgres",std::env::var("DB_PORT").unwrap()).parse().unwrap();
    let pool=Pool::builder(Manager::new(db,NoTls)).max_size(8).build().unwrap();
    let data=(1..=100000).filter(|i|i%2==1).map(|i| Trade{id:i,symbol:if i%3==0{"EURUSD"}else{"XAUUSD"}.into(),pnl_cents:(i*17)%20001-10000}).collect();
    let sql=std::fs::read_to_string("query.sql").unwrap();
    let app=Router::new().route("/json",get(small)).route("/trades",get(trades)).route("/db",get(database)).with_state(Arc::new(App{data,pool,sql}));
    let listener=tokio::net::TcpListener::bind(format!("127.0.0.1:{}",std::env::var("PORT").unwrap())).await.unwrap();
    axum::serve(listener,app).await.unwrap();
}
