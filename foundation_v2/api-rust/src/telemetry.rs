use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Default)]
pub struct Telemetry {
    pub completed: AtomicU64,
    pub failed: AtomicU64,
    pub rejected: AtomicU64,
    pub elapsed_microseconds: AtomicU64,
    buckets: [AtomicU64; 11],
}
impl Telemetry {
    pub fn record(&self, failed: bool, micros: u64) {
        self.completed.fetch_add(1, Ordering::Relaxed);
        if failed {
            self.failed.fetch_add(1, Ordering::Relaxed);
        }
        self.elapsed_microseconds
            .fetch_add(micros, Ordering::Relaxed);
        for (i, upper) in [
            1000,
            5000,
            10000,
            25000,
            50000,
            100000,
            250000,
            500000,
            1000000,
            5000000,
            u64::MAX,
        ]
        .iter()
        .enumerate()
        {
            if micros <= *upper {
                self.buckets[i].fetch_add(1, Ordering::Relaxed);
            }
        }
    }
    pub fn render(&self, pool_size: usize, available: usize, waiting: usize) -> String {
        let mut text = format!(
            "# TYPE tw_http_completed_total counter\ntw_http_completed_total {}\n# TYPE tw_http_failed_total counter\ntw_http_failed_total {}\n# TYPE tw_http_rejected_total counter\ntw_http_rejected_total {}\n# TYPE tw_http_duration_seconds histogram\ntw_http_duration_seconds_sum {:.6}\ntw_http_duration_seconds_count {}\n# TYPE tw_db_pool_size gauge\ntw_db_pool_size {pool_size}\n# TYPE tw_db_pool_available gauge\ntw_db_pool_available {available}\n# TYPE tw_db_pool_waiting gauge\ntw_db_pool_waiting {waiting}\n",
            self.completed.load(Ordering::Relaxed),
            self.failed.load(Ordering::Relaxed),
            self.rejected.load(Ordering::Relaxed),
            self.elapsed_microseconds.load(Ordering::Relaxed) as f64 / 1_000_000.0,
            self.completed.load(Ordering::Relaxed)
        );
        for (i, upper) in [
            "0.001", "0.005", "0.01", "0.025", "0.05", "0.1", "0.25", "0.5", "1", "5", "+Inf",
        ]
        .iter()
        .enumerate()
        {
            text.push_str(&format!(
                "tw_http_duration_seconds_bucket{{le=\"{upper}\"}} {}\n",
                self.buckets[i].load(Ordering::Relaxed)
            ));
        }
        text
    }
}
pub fn initialize() {
    let filter =
        tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());
    let _ = tracing_subscriber::fmt()
        .json()
        .with_env_filter(filter)
        .try_init();
}
