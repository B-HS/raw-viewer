pub mod queue;
pub mod store;

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Condvar, Mutex, PoisonError, RwLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::cache::DiskCache;
use crate::events::{self, RevCounters};
use crate::scan::Registry;
use crate::types::{DecodeFailedPayload, LevelReadyPayload, ProxyLevel};
use crate::types_performance::{DecodeCrashLoopPayload, L2Policy, PerfSettings, EVENT_DECODE_CRASH_LOOP};

use self::queue::{CancelFlag, Job, JobQueue};
use self::store::{parse_aeth_header, PixelStore, DEFAULT_BUDGET_BYTES};

pub const PRIO_CURRENT_L0: u32 = 0;
pub const PRIO_CURRENT_L1: u32 = 10;
pub const PRIO_CURRENT_L2: u32 = 20;
pub const PRIO_NEIGHBOR_BASE: u32 = 100;

const RAPID_WINDOW: Duration = Duration::from_millis(100);
const IDLE_DELAY: Duration = Duration::from_millis(150);
const TIMER_POLL: Duration = Duration::from_millis(250);

pub struct Services {
    pub registry: Registry,
    pub store: PixelStore,
    pub cache: DiskCache,
    pub revs: RevCounters,
}

impl Services {
    pub fn new() -> Self {
        Self {
            registry: Registry::new(),
            store: PixelStore::new(DEFAULT_BUDGET_BYTES),
            cache: DiskCache::new(),
            revs: RevCounters::new(),
        }
    }
}

impl Default for Services {
    fn default() -> Self {
        Self::new()
    }
}

pub struct AppState {
    pub services: Arc<Services>,
    pub pipeline: Pipeline,
}

impl AppState {
    pub fn new(app: AppHandle) -> Self {
        let services = Arc::new(Services::new());
        let pipeline = Pipeline::new(app, Arc::clone(&services));
        Self { services, pipeline }
    }
}

#[derive(Clone)]
struct LevelMeta {
    width: u32,
    height: u32,
    flip: u8,
    has_color_profile: Option<bool>,
    color_matrix: Option<Vec<f32>>,
}

struct Decoded {
    body: Vec<u8>,
    width: u32,
    height: u32,
    flip: u8,
    has_color_profile: Option<bool>,
    color_matrix: Option<Vec<f32>>,
}

enum DecodeOutcome {
    Cancelled,
    Failed(String),
    Panicked(String),
}

#[derive(Default)]
struct NavState {
    last: Option<Instant>,
}

struct IdleState {
    generation: u64,
    deadline: Instant,
    fired: bool,
    window: Option<(String, Vec<String>, Vec<String>)>,
}

#[derive(Default)]
struct PendingSet {
    inner: Mutex<HashMap<(String, ProxyLevel), CancelFlag>>,
}

impl PendingSet {
    fn reserve(&self, id: &str, level: ProxyLevel, flag: &CancelFlag) -> bool {
        let mut map = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        let key = (id.to_owned(), level);
        if let Some(existing) = map.get(&key) {
            if !existing.load(Ordering::Relaxed) {
                return false;
            }
        }
        map.insert(key, Arc::clone(flag));
        true
    }

    fn release(&self, id: &str, level: ProxyLevel, flag: &CancelFlag) {
        let mut map = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        let key = (id.to_owned(), level);
        if map.get(&key).is_some_and(|existing| Arc::ptr_eq(existing, flag)) {
            map.remove(&key);
        }
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner).len()
    }
}

struct Shared {
    app: AppHandle,
    services: Arc<Services>,
    queue: JobQueue,
    meta: Mutex<HashMap<(String, ProxyLevel), LevelMeta>>,
    active: Mutex<HashMap<String, CancelFlag>>,
    pending: PendingSet,
    nav: Mutex<NavState>,
    idle: (Mutex<IdleState>, Condvar),
    shutdown: AtomicBool,
    settings: RwLock<PerfSettings>,
    crash_count: AtomicU32,
}

pub struct Pipeline {
    shared: Arc<Shared>,
}

impl Pipeline {
    pub fn new(app: AppHandle, services: Arc<Services>) -> Self {
        let shared = Arc::new(Shared {
            app,
            services,
            queue: JobQueue::new(),
            meta: Mutex::new(HashMap::new()),
            active: Mutex::new(HashMap::new()),
            pending: PendingSet::default(),
            nav: Mutex::new(NavState::default()),
            idle: (
                Mutex::new(IdleState {
                    generation: 0,
                    deadline: Instant::now(),
                    fired: true,
                    window: None,
                }),
                Condvar::new(),
            ),
            shutdown: AtomicBool::new(false),
            settings: RwLock::new(PerfSettings::default()),
            crash_count: AtomicU32::new(0),
        });
        for _ in 0..worker_count() {
            let worker_shared = Arc::clone(&shared);
            let _ = std::thread::Builder::new()
                .name("decode-worker".to_owned())
                .spawn(move || run_worker(worker_shared));
        }
        let timer_shared = Arc::clone(&shared);
        let _ = std::thread::Builder::new()
            .name("decode-idle-timer".to_owned())
            .spawn(move || run_timer(timer_shared));
        Self { shared }
    }

    pub fn navigate(&self, current: String, prev: Vec<String>, next: Vec<String>) {
        self.shared.navigate(current, prev, next);
    }

    pub fn set_settings(&self, settings: PerfSettings) {
        *self.shared.settings.write().unwrap_or_else(PoisonError::into_inner) = settings;
    }

    pub fn settings(&self) -> PerfSettings {
        *self.shared.settings.read().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn request_l2(&self, image_id: String) {
        self.shared.enqueue_current(&image_id, ProxyLevel::L2, PRIO_CURRENT_L2);
    }
}

impl Drop for Pipeline {
    fn drop(&mut self) {
        self.shared.shutdown.store(true, Ordering::Relaxed);
        self.shared.queue.shutdown();
        self.shared.idle.1.notify_all();
    }
}

fn worker_count() -> usize {
    // SPEC-GAP: contract asks for physical_cores-1; std has no physical-core count without an extra crate, so available_parallelism (logical) is used as a proxy. Exact on Apple Silicon (no SMT).
    let logical = std::thread::available_parallelism().map(|value| value.get()).unwrap_or(4);
    logical.saturating_sub(1).max(2)
}

fn neighbor_jobs(prev: &[String], next: &[String], out: &mut Vec<(u32, String, ProxyLevel)>) {
    for list in [prev, next] {
        for (index, id) in list.iter().enumerate() {
            let base = PRIO_NEIGHBOR_BASE + (index as u32) * 2;
            out.push((base, id.clone(), ProxyLevel::L0));
            if index <= 1 {
                out.push((base + 1, id.clone(), ProxyLevel::L1));
            }
        }
    }
}

pub fn plan_jobs(current: &str, prev: &[String], next: &[String], rapid: bool) -> Vec<(u32, String, ProxyLevel)> {
    let mut jobs = vec![(PRIO_CURRENT_L0, current.to_owned(), ProxyLevel::L0)];
    if !rapid {
        jobs.push((PRIO_CURRENT_L1, current.to_owned(), ProxyLevel::L1));
        neighbor_jobs(prev, next, &mut jobs);
    }
    jobs
}

pub fn plan_idle(current: &str, prev: &[String], next: &[String]) -> Vec<(u32, String, ProxyLevel)> {
    let mut jobs = vec![
        (PRIO_CURRENT_L1, current.to_owned(), ProxyLevel::L1),
        (PRIO_CURRENT_L2, current.to_owned(), ProxyLevel::L2),
    ];
    neighbor_jobs(prev, next, &mut jobs);
    jobs
}

fn should_auto_l2_on_navigate(policy: L2Policy, rapid: bool) -> bool {
    matches!(policy, L2Policy::Always) && !rapid
}

fn should_suppress_idle_l2(policy: L2Policy) -> bool {
    matches!(policy, L2Policy::Zoom)
}

impl Shared {
    fn navigate(&self, current: String, mut prev: Vec<String>, mut next: Vec<String>) {
        let settings = *self.settings.read().unwrap_or_else(PoisonError::into_inner);
        let radius = settings.preload_radius as usize;
        prev.truncate(radius);
        next.truncate(radius);

        let now = Instant::now();
        let rapid = {
            let mut nav = self.nav.lock().unwrap_or_else(PoisonError::into_inner);
            let rapid = nav.last.is_some_and(|last| now.duration_since(last) < RAPID_WINDOW);
            nav.last = Some(now);
            rapid
        };
        self.services.store.set_current(Some(current.clone()));

        let mut window: HashSet<String> = HashSet::new();
        window.insert(current.clone());
        for id in prev.iter().chain(next.iter()) {
            window.insert(id.clone());
        }
        self.cancel_outside(&window);

        for (priority, id, level) in plan_jobs(&current, &prev, &next, rapid) {
            if id == current {
                self.enqueue_current(&id, level, priority);
            } else {
                self.enqueue_neighbor(&id, level, priority);
            }
        }
        if should_auto_l2_on_navigate(settings.l2_policy, rapid) {
            self.enqueue_current(&current, ProxyLevel::L2, PRIO_CURRENT_L2);
        }
        self.arm_idle(current, prev, next);
    }

    fn arm_idle(&self, current: String, prev: Vec<String>, next: Vec<String>) {
        let (lock, cvar) = &self.idle;
        {
            let mut idle = lock.lock().unwrap_or_else(PoisonError::into_inner);
            idle.generation += 1;
            idle.deadline = Instant::now() + IDLE_DELAY;
            idle.fired = false;
            idle.window = Some((current, prev, next));
        }
        cvar.notify_all();
    }

    fn cancel_for(&self, id: &str) -> CancelFlag {
        let mut active = self.active.lock().unwrap_or_else(PoisonError::into_inner);
        Arc::clone(active.entry(id.to_owned()).or_insert_with(|| Arc::new(AtomicBool::new(false))))
    }

    fn cancel_outside(&self, window: &HashSet<String>) {
        let mut active = self.active.lock().unwrap_or_else(PoisonError::into_inner);
        active.retain(|id, flag| {
            if window.contains(id) {
                true
            } else {
                flag.store(true, Ordering::Relaxed);
                false
            }
        });
    }

    fn remember(&self, id: &str, level: ProxyLevel, meta: LevelMeta) {
        let mut map = self.meta.lock().unwrap_or_else(PoisonError::into_inner);
        map.insert((id.to_owned(), level), meta);
    }

    fn recall(&self, id: &str, level: ProxyLevel) -> Option<LevelMeta> {
        let map = self.meta.lock().unwrap_or_else(PoisonError::into_inner);
        map.get(&(id.to_owned(), level)).cloned()
    }

    fn reemit(&self, id: &str, level: ProxyLevel) {
        if let Some(meta) = self.recall(id, level) {
            let rev = self.services.revs.next(id, level);
            events::emit_level_ready(
                &self.app,
                LevelReadyPayload {
                    image_id: id.to_owned(),
                    level,
                    rev,
                    width: meta.width,
                    height: meta.height,
                    flip: meta.flip,
                    has_color_profile: meta.has_color_profile,
                    color_matrix: meta.color_matrix,
                },
            );
        }
    }

    fn enqueue_current(&self, id: &str, level: ProxyLevel, priority: u32) {
        if self.services.store.contains(id, level) {
            self.reemit(id, level);
            return;
        }
        let flag = self.cancel_for(id);
        if self.pending.reserve(id, level, &flag) {
            self.queue.push(priority, id.to_owned(), level, flag);
        }
    }

    fn enqueue_neighbor(&self, id: &str, level: ProxyLevel, priority: u32) {
        if self.services.store.contains(id, level) {
            return;
        }
        let flag = self.cancel_for(id);
        if self.pending.reserve(id, level, &flag) {
            self.queue.push(priority, id.to_owned(), level, flag);
        }
    }

    fn process_job(&self, job: Job) {
        let id = job.image_id.clone();
        let level = job.level;
        let flag = Arc::clone(&job.cancel);
        self.run_job(job);
        self.pending.release(&id, level, &flag);
    }

    fn run_job(&self, job: Job) {
        if job.cancel.load(Ordering::Relaxed) {
            return;
        }
        if self.services.store.contains(&job.image_id, job.level) {
            return;
        }
        let path = match self.services.registry.resolve(&job.image_id) {
            Some(path) => path,
            None => {
                events::emit_decode_failed(
                    &self.app,
                    DecodeFailedPayload {
                        image_id: job.image_id.clone(),
                        level: job.level,
                        message: "image id is not registered".to_owned(),
                    },
                );
                return;
            }
        };
        if let Some(decoded) = self.load_from_cache(&path, job.level) {
            self.finalize(&path, &job, decoded, true);
            return;
        }
        if job.cancel.load(Ordering::Relaxed) {
            return;
        }
        let isolated = self.settings.read().unwrap_or_else(PoisonError::into_inner).isolated_decode;
        match decode_level(&path, job.level, &job.cancel, isolated) {
            Ok(decoded) => self.finalize(&path, &job, decoded, false),
            Err(DecodeOutcome::Cancelled) => {}
            Err(DecodeOutcome::Panicked(message)) => {
                let count = self.crash_count.fetch_add(1, Ordering::Relaxed) + 1;
                tracing::warn!(image_id = %job.image_id, level = ?job.level, count, %message, "image:decode-failed (panic)");
                if count >= 2 {
                    if let Err(error) = self.app.emit(EVENT_DECODE_CRASH_LOOP, DecodeCrashLoopPayload { count }) {
                        tracing::warn!(%error, "emit decode:crash-loop failed");
                    }
                }
                events::emit_decode_failed(
                    &self.app,
                    DecodeFailedPayload {
                        image_id: job.image_id.clone(),
                        level: job.level,
                        message,
                    },
                );
            }
            Err(DecodeOutcome::Failed(message)) => {
                tracing::warn!(image_id = %job.image_id, level = ?job.level, %message, "image:decode-failed");
                events::emit_decode_failed(
                    &self.app,
                    DecodeFailedPayload {
                        image_id: job.image_id.clone(),
                        level: job.level,
                        message,
                    },
                );
            }
        }
    }

    fn load_from_cache(&self, path: &Path, level: ProxyLevel) -> Option<Decoded> {
        match level {
            ProxyLevel::L0 => {
                let jpeg = self.services.cache.load_l0(path)?;
                let (width, height) = jpeg_dimensions(&jpeg).unwrap_or((0, 0));
                Some(Decoded {
                    body: jpeg,
                    width,
                    height,
                    flip: 0,
                    has_color_profile: None,
                    color_matrix: None,
                })
            }
            ProxyLevel::L1 => {
                let cached = self.services.cache.load_l1(path)?;
                let header = parse_aeth_header(&cached.body)?;
                Some(Decoded {
                    body: cached.body,
                    width: header.width,
                    height: header.height,
                    flip: cached.flip,
                    has_color_profile: Some(cached.has_color_profile),
                    color_matrix: cached.color_matrix,
                })
            }
            ProxyLevel::L2 => None,
        }
    }

    fn finalize(&self, path: &Path, job: &Job, decoded: Decoded, from_cache: bool) {
        if !from_cache {
            match job.level {
                ProxyLevel::L0 => self.services.cache.store_l0(path, &decoded.body),
                ProxyLevel::L1 => self.services.cache.store_l1(
                    path,
                    &decoded.body,
                    decoded.flip,
                    decoded.has_color_profile.unwrap_or(false),
                    decoded.color_matrix.as_deref(),
                ),
                ProxyLevel::L2 => {}
            }
        }
        self.remember(
            &job.image_id,
            job.level,
            LevelMeta {
                width: decoded.width,
                height: decoded.height,
                flip: decoded.flip,
                has_color_profile: decoded.has_color_profile,
                color_matrix: decoded.color_matrix.clone(),
            },
        );
        self.services.store.insert(job.image_id.clone(), job.level, Arc::new(decoded.body));
        let rev = self.services.revs.next(&job.image_id, job.level);
        let elapsed_ms = job.enqueued_at.elapsed().as_millis();
        tracing::info!(image_id = %job.image_id, level = ?job.level, rev, elapsed_ms, "image:level-ready");
        events::emit_level_ready(
            &self.app,
            LevelReadyPayload {
                image_id: job.image_id.clone(),
                level: job.level,
                rev,
                width: decoded.width,
                height: decoded.height,
                flip: decoded.flip,
                has_color_profile: decoded.has_color_profile,
                color_matrix: decoded.color_matrix,
            },
        );
    }
}

fn run_worker(shared: Arc<Shared>) {
    while let Some(job) = shared.queue.pop_blocking() {
        shared.process_job(job);
    }
}

fn run_timer(shared: Arc<Shared>) {
    let (lock, cvar) = &shared.idle;
    loop {
        if shared.shutdown.load(Ordering::Relaxed) {
            return;
        }
        let mut idle = lock.lock().unwrap_or_else(PoisonError::into_inner);
        let now = Instant::now();
        if !idle.fired && idle.window.is_some() && now >= idle.deadline {
            idle.fired = true;
            let window = idle.window.clone();
            drop(idle);
            if let Some((current, prev, next)) = window {
                let policy = shared.settings.read().unwrap_or_else(PoisonError::into_inner).l2_policy;
                for (priority, id, level) in plan_idle(&current, &prev, &next) {
                    if id == current && level == ProxyLevel::L2 && should_suppress_idle_l2(policy) {
                        continue;
                    }
                    if id == current {
                        shared.enqueue_current(&id, level, priority);
                    } else {
                        shared.enqueue_neighbor(&id, level, priority);
                    }
                }
            }
            continue;
        }
        if !idle.fired && idle.window.is_some() {
            let wait = idle.deadline.saturating_duration_since(now);
            let _ = cvar.wait_timeout(idle, wait);
        } else {
            let _ = cvar.wait_timeout(idle, TIMER_POLL);
        }
    }
}

#[cfg(feature = "libraw")]
fn decode_level(path: &Path, level: ProxyLevel, cancel: &CancelFlag, isolated: bool) -> Result<Decoded, DecodeOutcome> {
    use crate::decode::{self, DecodeError, DecodedRaw};
    use crate::isolate::IsolatedDecoded;

    fn map_error(error: DecodeError) -> DecodeOutcome {
        match error {
            DecodeError::Cancelled => DecodeOutcome::Cancelled,
            DecodeError::Panic => DecodeOutcome::Panicked(error.to_string()),
            other => DecodeOutcome::Failed(other.to_string()),
        }
    }

    fn map_isolated_error(error: DecodeError) -> DecodeOutcome {
        match error {
            DecodeError::Cancelled => DecodeOutcome::Cancelled,
            other => DecodeOutcome::Failed(other.to_string()),
        }
    }

    fn build_aeth(raw: DecodedRaw) -> Decoded {
        let body = store::serialize_aeth(raw.width, raw.height, &raw.rgb_f16);
        let has_color_profile = raw.cam_to_rec2020.is_some();
        let color_matrix = raw.cam_to_rec2020.map(|matrix| matrix.to_vec());
        Decoded {
            body,
            width: raw.width,
            height: raw.height,
            flip: raw.flip,
            has_color_profile: Some(has_color_profile),
            color_matrix,
        }
    }

    fn from_isolated(decoded: IsolatedDecoded) -> Decoded {
        Decoded {
            body: decoded.body,
            width: decoded.width,
            height: decoded.height,
            flip: decoded.flip,
            has_color_profile: decoded.has_color_profile,
            color_matrix: decoded.color_matrix,
        }
    }

    match level {
        ProxyLevel::L0 => {
            let thumb = decode::extract_thumb(path).map_err(map_error)?;
            Ok(Decoded {
                body: thumb.jpeg,
                width: thumb.width,
                height: thumb.height,
                flip: 0,
                has_color_profile: None,
                color_matrix: None,
            })
        }
        ProxyLevel::L1 | ProxyLevel::L2 => {
            if isolated {
                Ok(from_isolated(crate::isolate::decode_via_subprocess(path, level, cancel).map_err(map_isolated_error)?))
            } else if level == ProxyLevel::L1 {
                Ok(build_aeth(decode::decode_half(path, cancel).map_err(map_error)?))
            } else {
                Ok(build_aeth(decode::decode_full(path, cancel).map_err(map_error)?))
            }
        }
    }
}

#[cfg(not(feature = "libraw"))]
fn decode_level(_path: &Path, _level: ProxyLevel, _cancel: &CancelFlag, _isolated: bool) -> Result<Decoded, DecodeOutcome> {
    Err(DecodeOutcome::Failed("libraw feature disabled".to_owned()))
}

fn jpeg_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if data.len() < 4 || data[0] != 0xFF || data[1] != 0xD8 {
        return None;
    }
    let mut index = 2;
    while index + 9 < data.len() {
        if data[index] != 0xFF {
            index += 1;
            continue;
        }
        let marker = data[index + 1];
        if marker == 0xD8 || marker == 0xD9 || (0xD0..=0xD7).contains(&marker) || marker == 0xFF {
            index += 2;
            continue;
        }
        let length = ((data[index + 2] as usize) << 8) | data[index + 3] as usize;
        let is_sof = matches!(marker, 0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF);
        if is_sof {
            let height = ((data[index + 5] as u32) << 8) | data[index + 6] as u32;
            let width = ((data[index + 7] as u32) << 8) | data[index + 8] as u32;
            return Some((width, height));
        }
        index += 2 + length;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn plan_jobs_normal_enqueues_current_l0_l1_and_neighbors() {
        let jobs = plan_jobs("cur", &ids(&["p1", "p2", "p3"]), &ids(&["n1"]), false);
        assert_eq!(jobs[0], (PRIO_CURRENT_L0, "cur".to_owned(), ProxyLevel::L0));
        assert_eq!(jobs[1], (PRIO_CURRENT_L1, "cur".to_owned(), ProxyLevel::L1));
        assert!(jobs.contains(&(PRIO_NEIGHBOR_BASE, "p1".to_owned(), ProxyLevel::L0)));
        assert!(jobs.contains(&(PRIO_NEIGHBOR_BASE + 1, "p1".to_owned(), ProxyLevel::L1)));
        assert!(jobs.contains(&(PRIO_NEIGHBOR_BASE + 2, "p2".to_owned(), ProxyLevel::L0)));
        assert!(jobs.contains(&(PRIO_NEIGHBOR_BASE + 3, "p2".to_owned(), ProxyLevel::L1)));
        assert!(jobs.contains(&(PRIO_NEIGHBOR_BASE + 4, "p3".to_owned(), ProxyLevel::L0)));
        assert!(!jobs.contains(&(PRIO_NEIGHBOR_BASE + 5, "p3".to_owned(), ProxyLevel::L1)));
        assert!(jobs.contains(&(PRIO_NEIGHBOR_BASE, "n1".to_owned(), ProxyLevel::L0)));
    }

    #[test]
    fn plan_jobs_rapid_enqueues_only_current_l0() {
        let jobs = plan_jobs("cur", &ids(&["p1"]), &ids(&["n1"]), true);
        assert_eq!(jobs, vec![(PRIO_CURRENT_L0, "cur".to_owned(), ProxyLevel::L0)]);
    }

    #[test]
    fn plan_idle_restores_l1_l2_and_neighbors() {
        let jobs = plan_idle("cur", &ids(&["p1"]), &ids(&["n1"]));
        assert_eq!(jobs[0], (PRIO_CURRENT_L1, "cur".to_owned(), ProxyLevel::L1));
        assert_eq!(jobs[1], (PRIO_CURRENT_L2, "cur".to_owned(), ProxyLevel::L2));
        assert!(jobs.contains(&(PRIO_NEIGHBOR_BASE, "p1".to_owned(), ProxyLevel::L0)));
        assert!(jobs.contains(&(PRIO_NEIGHBOR_BASE, "n1".to_owned(), ProxyLevel::L0)));
    }

    #[test]
    fn worker_count_is_at_least_two() {
        assert!(worker_count() >= 2);
    }

    #[test]
    fn default_settings_preserve_current_l2_behavior() {
        let settings = PerfSettings::default();
        assert_eq!(settings.preload_radius, 3);
        assert_eq!(settings.l2_policy, L2Policy::Idle);
        assert!(!settings.isolated_decode);
        assert!(!should_auto_l2_on_navigate(settings.l2_policy, false));
        assert!(!should_suppress_idle_l2(settings.l2_policy));
    }

    #[test]
    fn always_policy_adds_navigate_l2_unless_rapid() {
        assert!(should_auto_l2_on_navigate(L2Policy::Always, false));
        assert!(!should_auto_l2_on_navigate(L2Policy::Always, true));
        assert!(!should_auto_l2_on_navigate(L2Policy::Idle, false));
        assert!(!should_auto_l2_on_navigate(L2Policy::Zoom, false));
    }

    #[test]
    fn zoom_policy_suppresses_idle_l2_only() {
        assert!(should_suppress_idle_l2(L2Policy::Zoom));
        assert!(!should_suppress_idle_l2(L2Policy::Idle));
        assert!(!should_suppress_idle_l2(L2Policy::Always));
    }

    #[test]
    fn jpeg_dimensions_reads_sof0() {
        let jpeg = [
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x01, 0x2C, 0x02, 0x00, 0x03,
        ];
        assert_eq!(jpeg_dimensions(&jpeg), Some((512, 300)));
    }

    #[test]
    fn jpeg_dimensions_rejects_non_jpeg() {
        assert_eq!(jpeg_dimensions(&[0x00, 0x01, 0x02, 0x03]), None);
    }

    fn flag() -> CancelFlag {
        Arc::new(AtomicBool::new(false))
    }

    #[test]
    fn pending_reserve_dedups_live_jobs_and_frees_on_release() {
        let pending = PendingSet::default();
        let owner = flag();
        assert!(pending.reserve("a", ProxyLevel::L1, &owner));
        assert!(!pending.reserve("a", ProxyLevel::L1, &owner));
        assert!(!pending.reserve("a", ProxyLevel::L1, &flag()));
        assert!(pending.reserve("a", ProxyLevel::L0, &owner));
        pending.release("a", ProxyLevel::L1, &owner);
        assert_eq!(pending.len(), 1);
        assert!(pending.reserve("a", ProxyLevel::L1, &owner));
    }

    #[test]
    fn pending_supersedes_cancelled_owner_and_ignores_stale_release() {
        let pending = PendingSet::default();
        let stale = flag();
        assert!(pending.reserve("b", ProxyLevel::L1, &stale));
        stale.store(true, Ordering::Relaxed);
        let fresh = flag();
        assert!(pending.reserve("b", ProxyLevel::L1, &fresh));
        pending.release("b", ProxyLevel::L1, &stale);
        assert_eq!(pending.len(), 1);
        pending.release("b", ProxyLevel::L1, &fresh);
        assert_eq!(pending.len(), 0);
    }
}
