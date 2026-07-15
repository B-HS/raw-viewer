use std::path::PathBuf;
use std::sync::{LazyLock, Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

pub const USER_AGENT: &str = "raw-viewer/0.1 (github.com/B-HS/raw-viewer)";
pub const MIN_INTERVAL: Duration = Duration::from_millis(1100);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

static GLOBAL_CACHE: LazyLock<GeocodeCache> = LazyLock::new(GeocodeCache::new);
static GLOBAL_LIMITER: LazyLock<RateLimiter> = LazyLock::new(|| RateLimiter::new(MIN_INTERVAL));

fn round4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

fn cache_key(lat: f64, lng: f64) -> String {
    format!("{:.4}_{:.4}", round4(lat), round4(lng))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct CacheRecord {
    display_name: String,
}

pub struct GeocodeCache {
    root: PathBuf,
}

impl GeocodeCache {
    fn new() -> Self {
        let root = dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join(crate::cache::APP_CACHE_DIR).join("geocode");
        Self { root }
    }

    #[cfg(test)]
    fn with_root(root: PathBuf) -> Self {
        Self { root }
    }

    fn path_for(&self, key: &str) -> PathBuf {
        self.root.join(format!("{key}.json"))
    }

    fn load(&self, key: &str) -> Option<String> {
        let raw = std::fs::read(self.path_for(key)).ok()?;
        let record: CacheRecord = serde_json::from_slice(&raw).ok()?;
        Some(record.display_name)
    }

    fn store(&self, key: &str, display_name: &str) {
        if std::fs::create_dir_all(&self.root).is_err() {
            return;
        }
        let record = CacheRecord {
            display_name: display_name.to_owned(),
        };
        if let Ok(json) = serde_json::to_vec(&record) {
            let _ = std::fs::write(self.path_for(key), json);
        }
    }
}

pub struct RateLimiter {
    interval: Duration,
    last: Mutex<Option<Instant>>,
}

impl RateLimiter {
    fn new(interval: Duration) -> Self {
        Self {
            interval,
            last: Mutex::new(None),
        }
    }

    fn wait(&self) {
        let mut last = self.last.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(previous) = *last {
            let elapsed = previous.elapsed();
            if elapsed < self.interval {
                std::thread::sleep(self.interval - elapsed);
            }
        }
        *last = Some(Instant::now());
    }
}

fn parse_display_name(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    value.get("display_name")?.as_str().map(str::to_owned)
}

fn nominatim_fetch(lat: f64, lng: f64) -> Option<String> {
    let url = format!("https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat={lat:.4}&lon={lng:.4}");
    let connector = native_tls::TlsConnector::new().ok()?;
    let agent = ureq::builder().tls_connector(std::sync::Arc::new(connector)).build();
    let response = agent.get(&url).timeout(REQUEST_TIMEOUT).set("User-Agent", USER_AGENT).call().ok()?;
    let body = response.into_string().ok()?;
    parse_display_name(&body)
}

fn reverse_with(cache: &GeocodeCache, limiter: &RateLimiter, lat: f64, lng: f64, fetch: &dyn Fn(f64, f64) -> Option<String>) -> Option<String> {
    if !lat.is_finite() || !lng.is_finite() {
        return None;
    }
    let key = cache_key(lat, lng);
    if let Some(cached) = cache.load(&key) {
        return Some(cached);
    }
    limiter.wait();
    let result = fetch(round4(lat), round4(lng));
    if let Some(display_name) = &result {
        cache.store(&key, display_name);
    }
    result
}

pub fn reverse(lat: f64, lng: f64) -> Option<String> {
    reverse_with(&GLOBAL_CACHE, &GLOBAL_LIMITER, lat, lng, &nominatim_fetch)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("raw-viewer-geocode-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        root
    }

    #[test]
    fn cache_key_rounds_to_four_decimals() {
        assert_eq!(cache_key(37.566500123, 126.9780004), "37.5665_126.9780");
        assert_eq!(cache_key(-33.868800, 151.209300), "-33.8688_151.2093");
        assert_eq!(cache_key(37.56651, 37.56649), "37.5665_37.5665");
    }

    #[test]
    fn cache_store_and_load_roundtrip() {
        let cache = GeocodeCache::with_root(temp_root("store"));
        assert_eq!(cache.load("37.5665_126.9780"), None);
        cache.store("37.5665_126.9780", "Seoul, South Korea");
        assert_eq!(cache.load("37.5665_126.9780").as_deref(), Some("Seoul, South Korea"));
        let _ = std::fs::remove_dir_all(&cache.root);
    }

    #[test]
    fn reverse_uses_cache_before_fetch_and_rounds_request() {
        let cache = GeocodeCache::with_root(temp_root("reverse"));
        let limiter = RateLimiter::new(Duration::from_millis(0));
        let calls = AtomicUsize::new(0);
        let seen: Mutex<Option<(f64, f64)>> = Mutex::new(None);
        let fetch = |lat: f64, lng: f64| {
            calls.fetch_add(1, Ordering::Relaxed);
            *seen.lock().unwrap_or_else(PoisonError::into_inner) = Some((lat, lng));
            Some("Somewhere".to_owned())
        };

        let first = reverse_with(&cache, &limiter, 37.566500123, 126.9780004, &fetch);
        assert_eq!(first.as_deref(), Some("Somewhere"));
        assert_eq!(calls.load(Ordering::Relaxed), 1);
        assert_eq!(*seen.lock().unwrap_or_else(PoisonError::into_inner), Some((37.5665, 126.978)));

        let second = reverse_with(&cache, &limiter, 37.566500999, 126.9780001, &fetch);
        assert_eq!(second.as_deref(), Some("Somewhere"));
        assert_eq!(calls.load(Ordering::Relaxed), 1, "second lookup within 4-decimal key must hit cache");
        let _ = std::fs::remove_dir_all(&cache.root);
    }

    #[test]
    fn reverse_does_not_cache_missing_result() {
        let cache = GeocodeCache::with_root(temp_root("miss"));
        let limiter = RateLimiter::new(Duration::from_millis(0));
        let calls = AtomicUsize::new(0);
        let fetch = |_lat: f64, _lng: f64| {
            calls.fetch_add(1, Ordering::Relaxed);
            None::<String>
        };
        assert_eq!(reverse_with(&cache, &limiter, 1.0, 2.0, &fetch), None);
        assert_eq!(reverse_with(&cache, &limiter, 1.0, 2.0, &fetch), None);
        assert_eq!(calls.load(Ordering::Relaxed), 2, "missing results must not be cached");
        let _ = std::fs::remove_dir_all(&cache.root);
    }

    #[test]
    fn rate_limiter_enforces_minimum_gap() {
        let limiter = RateLimiter::new(Duration::from_millis(60));
        let start = Instant::now();
        limiter.wait();
        limiter.wait();
        limiter.wait();
        let elapsed = start.elapsed();
        assert!(elapsed >= Duration::from_millis(120), "three waits at 60ms must take >=120ms, took {elapsed:?}");
        assert!(elapsed < Duration::from_secs(2), "rate limiter overshot: {elapsed:?}");
    }

    #[test]
    fn parse_display_name_reads_field_or_none() {
        assert_eq!(parse_display_name(r#"{"display_name":"Seoul, KR"}"#).as_deref(), Some("Seoul, KR"));
        assert_eq!(parse_display_name(r#"{"error":"Unable to geocode"}"#), None);
        assert_eq!(parse_display_name("not json"), None);
    }

    #[test]
    #[ignore]
    fn live_nominatim_reverse() {
        let result = nominatim_fetch(48.8584, 2.2945);
        eprintln!("live nominatim reverse: {result:?}");
        assert!(result.is_some(), "expected a live reverse-geocode result");
    }
}
