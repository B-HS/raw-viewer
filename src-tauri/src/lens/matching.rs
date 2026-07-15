use std::collections::HashSet;

use crate::lens::db::{CameraEntry, DistortionCalib, LensEntry, LensIndex, TcaCalib, VignettingCalib};
use crate::types_lens::{DistortionCoeffs, DistortionModel, LensProfileMatch, TcaCoeffs, TcaModel, VignettingCoeffs};

const CAMERA_MATCH_THRESHOLD: f64 = 0.40;
const LENS_MATCH_THRESHOLD: f64 = 0.50;
const CROP_COMPAT_RATIO: f64 = 0.96;
const DEFAULT_SUBJECT_DISTANCE: f64 = 1000.0;
const VIGNETTING_IDW_POWER: f64 = 3.5;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct LensQuery {
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub lens_make: Option<String>,
    pub lens_model: Option<String>,
    pub focal: Option<f64>,
    pub aperture: Option<f64>,
    pub distance: Option<f64>,
}

pub fn lens_key(make: Option<&str>, model: Option<&str>) -> Option<String> {
    let model = model.map(str::trim).filter(|value| !value.is_empty())?;
    let make = make.map(str::trim).unwrap_or_default();
    Some(format!("{}|{}", make.to_ascii_lowercase(), model.to_ascii_lowercase()))
}

pub fn find_profile(index: &LensIndex, query: &LensQuery, override_profile: Option<&str>) -> Option<LensProfileMatch> {
    let camera = find_camera(index, query);
    let camera_crop = camera.map(|entry| entry.crop_factor);

    let lens = match override_profile.and_then(|id| index.lens_by_profile(id)) {
        Some(lens) => lens,
        None => find_lens(index, query, camera)?,
    };

    let crop = camera_crop.unwrap_or(lens.crop_factor);
    build_match(lens, crop, query)
}

pub fn search_profiles(index: &LensIndex, query: &str, limit: usize) -> Vec<(String, String)> {
    let tokens = normalize(query);
    let mut scored: Vec<(f64, &LensEntry)> = index
        .lenses
        .iter()
        .filter_map(|lens| {
            let score = if tokens.is_empty() { 1.0 } else { lens_name_score(&tokens, lens) };
            (score > 0.0).then_some((score, lens))
        })
        .collect();
    scored.sort_by(|left, right| {
        right
            .0
            .partial_cmp(&left.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.1.display_name().cmp(&right.1.display_name()))
    });
    let mut seen = HashSet::new();
    scored
        .into_iter()
        .filter(|(_, lens)| seen.insert(lens.profile_id.clone()))
        .take(limit)
        .map(|(_, lens)| (lens.profile_id.clone(), lens.display_name()))
        .collect()
}

fn find_camera<'a>(index: &'a LensIndex, query: &LensQuery) -> Option<&'a CameraEntry> {
    let model = query.camera_model.as_deref()?;
    let model_tokens = normalize(model);
    if model_tokens.is_empty() {
        return None;
    }
    let make_tokens = query.camera_make.as_deref().map(normalize).unwrap_or_default();
    let mut best: Option<(f64, &CameraEntry)> = None;
    for camera in &index.cameras {
        let name_score = camera_name_score(&model_tokens, camera);
        if name_score < CAMERA_MATCH_THRESHOLD {
            continue;
        }
        let maker_bonus = if make_tokens.is_empty() || token_overlap(&make_tokens, &normalize(&camera.maker)) > 0.0 {
            0.1
        } else {
            0.0
        };
        let score = name_score + maker_bonus;
        if best.as_ref().map(|(current, _)| score > *current).unwrap_or(true) {
            best = Some((score, camera));
        }
    }
    best.map(|(_, camera)| camera)
}

fn find_lens<'a>(index: &'a LensIndex, query: &LensQuery, camera: Option<&CameraEntry>) -> Option<&'a LensEntry> {
    let lens_model = query.lens_model.as_deref()?;
    let tokens = normalize(lens_model);
    if tokens.is_empty() {
        return None;
    }
    let mut best: Option<(f64, &LensEntry)> = None;
    for lens in &index.lenses {
        if lens.calibration.is_empty() {
            continue;
        }
        if let Some(camera) = camera {
            if !mount_compatible(index, &camera.mount, &lens.mounts) {
                continue;
            }
        }
        let base = lens_name_score(&tokens, lens);
        if base < LENS_MATCH_THRESHOLD {
            continue;
        }
        let mut score = base;
        if let Some(make) = query.lens_make.as_deref() {
            if token_overlap(&normalize(make), &normalize(&lens.maker)) > 0.0 {
                score += 0.05;
            }
        }
        if query.focal.is_some() && focal_in_range(lens, query.focal) {
            score += 0.1;
        }
        if best.as_ref().map(|(current, _)| score > *current).unwrap_or(true) {
            best = Some((score, lens));
        }
    }
    best.map(|(_, lens)| lens)
}

fn build_match(lens: &LensEntry, camera_crop: f64, query: &LensQuery) -> Option<LensProfileMatch> {
    if lens.calibration.is_empty() {
        return None;
    }
    let crop_usable = crop_ratio_usable(camera_crop, lens.crop_factor);
    let focal = effective_focal(lens, query.focal);

    let distortion = crop_usable.then(|| interpolate_distortion(&lens.calibration.distortion, focal)).flatten();
    let tca = crop_usable.then(|| interpolate_tca(&lens.calibration.tca, focal)).flatten();
    let vignetting = crop_usable
        .then(|| interpolate_vignetting(lens, &lens.calibration.vignetting, focal, query.aperture, query.distance))
        .flatten();

    if distortion.is_none() && tca.is_none() && vignetting.is_none() {
        return None;
    }

    // SPEC-GAP: LensProfileMatch requires non-optional distortion/tca; when a matched lens lacks
    // that specific calibration we emit an identity (no-op) coefficient set so the shader can skip it.
    Some(LensProfileMatch {
        profile_id: lens.profile_id.clone(),
        lens_name: lens.display_name(),
        distortion: distortion.unwrap_or_else(identity_distortion),
        tca: tca.unwrap_or_else(identity_tca),
        vignetting: vignetting.map(|coeffs| VignettingCoeffs { coeffs: coeffs.to_vec() }),
    })
}

fn identity_distortion() -> DistortionCoeffs {
    DistortionCoeffs {
        model: DistortionModel::Poly3,
        coeffs: vec![0.0],
    }
}

fn identity_tca() -> TcaCoeffs {
    TcaCoeffs {
        model: TcaModel::Linear,
        coeffs: vec![1.0, 1.0],
    }
}

fn crop_ratio_usable(camera_crop: f64, lens_crop: f64) -> bool {
    if lens_crop <= 0.0 {
        return true;
    }
    camera_crop / lens_crop >= CROP_COMPAT_RATIO
}

fn effective_focal(lens: &LensEntry, focal: Option<f64>) -> f64 {
    if let Some(value) = focal.filter(|value| *value > 0.0) {
        return value;
    }
    if lens.focal_min > 0.0 && lens.focal_max >= lens.focal_min {
        return (lens.focal_min + lens.focal_max) / 2.0;
    }
    lens.focal_min
}

fn interpolate_distortion(entries: &[DistortionCalib], focal: f64) -> Option<DistortionCoeffs> {
    let model = entries.first()?.model;
    let selected: Vec<&DistortionCalib> = entries.iter().filter(|entry| entry.model == model).collect();
    let coeffs = interpolate_terms(&selected, focal, |entry| entry.focal, |entry| &entry.terms)?;
    Some(DistortionCoeffs { model, coeffs })
}

fn interpolate_tca(entries: &[TcaCalib], focal: f64) -> Option<TcaCoeffs> {
    let model = entries.first()?.model;
    let selected: Vec<&TcaCalib> = entries.iter().filter(|entry| entry.model == model).collect();
    let coeffs = interpolate_terms(&selected, focal, |entry| entry.focal, |entry| &entry.terms)?;
    Some(TcaCoeffs { model, coeffs })
}

// SPEC-GAP: lensfun interpolates distortion/TCA terms with a 4-point Catmull-Rom (Hermite) spline;
// the phase3d contract specifies linear-in-focal, which equals lensfun exactly for 2 bracketing
// points and deviates only when 3+ calibration focals surround the target. Out-of-range clamps.
fn interpolate_terms<T>(entries: &[&T], focal: f64, focal_of: impl Fn(&T) -> f64, terms_of: impl Fn(&T) -> &Vec<f64>) -> Option<Vec<f64>> {
    if entries.is_empty() {
        return None;
    }
    let mut sorted: Vec<&T> = entries.to_vec();
    sorted.sort_by(|left, right| focal_of(left).partial_cmp(&focal_of(right)).unwrap_or(std::cmp::Ordering::Equal));
    let first = *sorted.first()?;
    let last = *sorted.last()?;
    if focal <= focal_of(first) {
        return Some(terms_of(first).clone());
    }
    if focal >= focal_of(last) {
        return Some(terms_of(last).clone());
    }
    for pair in sorted.windows(2) {
        let low = pair[0];
        let high = pair[1];
        let low_focal = focal_of(low);
        let high_focal = focal_of(high);
        if focal >= low_focal && focal <= high_focal {
            let span = high_focal - low_focal;
            if span.abs() < f64::EPSILON {
                return Some(terms_of(low).clone());
            }
            let t = (focal - low_focal) / span;
            let low_terms = terms_of(low);
            let high_terms = terms_of(high);
            let count = low_terms.len().min(high_terms.len());
            let interpolated = (0..count).map(|index| low_terms[index] + (high_terms[index] - low_terms[index]) * t).collect();
            return Some(interpolated);
        }
    }
    Some(terms_of(last).clone())
}

fn interpolate_vignetting(
    lens: &LensEntry,
    entries: &[VignettingCalib],
    focal: f64,
    aperture: Option<f64>,
    distance: Option<f64>,
) -> Option<[f64; 3]> {
    let aperture = aperture.filter(|value| *value > 0.0)?;
    // SPEC-GAP: EXIF subject distance is usually absent; default to 1000 (~infinity focus), matching
    // lensfun's common far-field calibration point. IDW (power 3.5) over focal/aperture/distance is faithful.
    let distance = distance.filter(|value| *value > 0.0).unwrap_or(DEFAULT_SUBJECT_DISTANCE);
    if entries.is_empty() {
        return None;
    }
    let mut accum = [0.0f64; 3];
    let mut total_weight = 0.0f64;
    let mut smallest = f64::MAX;
    for entry in entries {
        let dist = vignetting_distance(lens, entry, focal, aperture, distance);
        if dist < 0.0001 {
            return Some(entry.terms);
        }
        smallest = smallest.min(dist);
        let weight = 1.0 / dist.powf(VIGNETTING_IDW_POWER);
        for index in 0..3 {
            accum[index] += weight * entry.terms[index];
        }
        total_weight += weight;
    }
    if smallest > 1.0 || total_weight <= 0.0 {
        return None;
    }
    Some([accum[0] / total_weight, accum[1] / total_weight, accum[2] / total_weight])
}

fn vignetting_distance(lens: &LensEntry, entry: &VignettingCalib, focal: f64, aperture: f64, distance: f64) -> f64 {
    let df = lens.focal_max - lens.focal_min;
    let (f1, f2) = if df.abs() > f64::EPSILON {
        ((focal - lens.focal_min) / df, (entry.focal - lens.focal_min) / df)
    } else {
        (focal - lens.focal_min, entry.focal - lens.focal_min)
    };
    let a1 = 4.0 / aperture;
    let a2 = 4.0 / entry.aperture;
    let d1 = 0.1 / distance;
    let d2 = 0.1 / entry.distance;
    ((f2 - f1).powi(2) + (a2 - a1).powi(2) + (d2 - d1).powi(2)).sqrt()
}

fn focal_in_range(lens: &LensEntry, focal: Option<f64>) -> bool {
    let focal = match focal.filter(|value| *value > 0.0) {
        Some(value) => value,
        None => return true,
    };
    if lens.focal_min <= 0.0 || lens.focal_max <= 0.0 {
        return true;
    }
    if (lens.focal_max - lens.focal_min).abs() < f64::EPSILON {
        return true;
    }
    focal >= lens.focal_min * 0.92 && focal <= lens.focal_max * 1.08
}

fn mount_compatible(index: &LensIndex, camera_mount: &str, lens_mounts: &[String]) -> bool {
    if lens_mounts.iter().any(|mount| mount == camera_mount) {
        return true;
    }
    if let Some(compat) = index.mounts.get(camera_mount) {
        if lens_mounts.iter().any(|mount| compat.iter().any(|entry| entry == mount)) {
            return true;
        }
    }
    false
}

fn camera_name_score(model_tokens: &[String], camera: &CameraEntry) -> f64 {
    let mut best = token_score(model_tokens, &normalize(&camera.model));
    for alias in &camera.aliases {
        best = best.max(token_score(model_tokens, &normalize(alias)));
    }
    best
}

fn lens_name_score(tokens: &[String], lens: &LensEntry) -> f64 {
    let mut best = token_score(tokens, &normalize(&lens.model));
    for alias in &lens.aliases {
        best = best.max(token_score(tokens, &normalize(alias)));
    }
    best
}

fn token_score(query: &[String], candidate: &[String]) -> f64 {
    if query.is_empty() || candidate.is_empty() {
        return 0.0;
    }
    let query_set: HashSet<&String> = query.iter().collect();
    let candidate_set: HashSet<&String> = candidate.iter().collect();
    let intersection = query_set.intersection(&candidate_set).count();
    if intersection == 0 {
        return 0.0;
    }
    let coverage = intersection as f64 / query_set.len() as f64;
    let union = query_set.union(&candidate_set).count();
    let jaccard = intersection as f64 / union as f64;
    0.7 * coverage + 0.3 * jaccard
}

fn token_overlap(left: &[String], right: &[String]) -> f64 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let left_set: HashSet<&String> = left.iter().collect();
    let right_set: HashSet<&String> = right.iter().collect();
    let intersection = left_set.intersection(&right_set).count();
    if intersection == 0 {
        return 0.0;
    }
    let union = left_set.union(&right_set).count();
    intersection as f64 / union as f64
}

fn normalize(value: &str) -> Vec<String> {
    value
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(|token| token.to_ascii_lowercase())
        .collect()
}
