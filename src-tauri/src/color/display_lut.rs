use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex, PoisonError};

use lcms2::{CIExyY, CIExyYTRIPLE, Intent, PixelFormat, Profile, ToneCurve, Transform};

pub const LUT_SIZE: u32 = 33;
pub const LUT_INTENT: &str = "relative-colorimetric";

type Cache = HashMap<[u8; 32], Arc<Vec<u8>>>;

static LUT_CACHE: LazyLock<Mutex<Cache>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn xy(x: f64, y: f64) -> CIExyY {
    CIExyY { x, y, Y: 1.0 }
}

pub(crate) fn rec2020_linear_profile() -> Option<Profile> {
    let white = xy(0.312_7, 0.329_0);
    let prims = CIExyYTRIPLE {
        Red: xy(0.708, 0.292),
        Green: xy(0.170, 0.797),
        Blue: xy(0.131, 0.046),
    };
    let linear = ToneCurve::new(1.0);
    Profile::new_rgb(&white, &prims, &[&linear, &linear, &linear]).ok()
}

pub fn build_lut_floats(icc: &[u8], size: u32) -> Option<Vec<f32>> {
    let source = rec2020_linear_profile()?;
    let dest = Profile::new_icc(icc).ok()?;
    let transform: Transform<[f32; 3], [f32; 3]> =
        Transform::new(&source, PixelFormat::RGB_FLT, &dest, PixelFormat::RGB_FLT, Intent::RelativeColorimetric).ok()?;
    let n = size as usize;
    if n < 2 {
        return None;
    }
    let width = n * n;
    let denom = (n - 1) as f32;
    let mut input: Vec<[f32; 3]> = Vec::with_capacity(width * n);
    for green in 0..n {
        for x in 0..width {
            let blue = x / n;
            let red = x % n;
            input.push([red as f32 / denom, green as f32 / denom, blue as f32 / denom]);
        }
    }
    let mut output = vec![[0.0f32; 3]; input.len()];
    transform.transform_pixels(&input, &mut output);
    let mut flat = Vec::with_capacity(output.len() * 3);
    for pixel in &output {
        flat.push(pixel[0].clamp(0.0, 1.0));
        flat.push(pixel[1].clamp(0.0, 1.0));
        flat.push(pixel[2].clamp(0.0, 1.0));
    }
    Some(flat)
}

fn encode_response(size: u32, floats: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(4 + floats.len() * 4);
    bytes.extend_from_slice(&size.to_le_bytes());
    for value in floats {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

pub fn display_lut_bytes(icc: &[u8]) -> Option<Vec<u8>> {
    let key = *blake3::hash(icc).as_bytes();
    if let Some(existing) = LUT_CACHE.lock().unwrap_or_else(PoisonError::into_inner).get(&key) {
        return Some(existing.as_ref().clone());
    }
    let floats = build_lut_floats(icc, LUT_SIZE)?;
    let arc = Arc::new(encode_response(LUT_SIZE, &floats));
    LUT_CACHE.lock().unwrap_or_else(PoisonError::into_inner).insert(key, arc.clone());
    Some(arc.as_ref().clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::color::{apply_matrix, encode_oetf, rec2020_to_target_matrix};
    use crate::types_export::ExportColorSpace;

    const N: usize = LUT_SIZE as usize;

    fn sample(floats: &[f32], size: usize, r: usize, g: usize, b: usize) -> [f32; 3] {
        let width = size * size;
        let base = (g * width + b * size + r) * 3;
        [floats[base], floats[base + 1], floats[base + 2]]
    }

    fn rec2020_linear_icc() -> Vec<u8> {
        rec2020_linear_profile().unwrap().icc().unwrap()
    }

    #[test]
    fn lut_has_expected_length() {
        let floats = build_lut_floats(&rec2020_linear_icc(), LUT_SIZE).unwrap();
        assert_eq!(floats.len(), N * N * N * 3);
    }

    #[test]
    fn identity_profile_yields_near_identity_lut() {
        let icc = rec2020_linear_icc();
        let floats = build_lut_floats(&icc, LUT_SIZE).unwrap();
        for &i in &[0usize, 8, 16, 24, 32] {
            for &j in &[0usize, 16, 32] {
                for &k in &[0usize, 12, 32] {
                    let got = sample(&floats, N, i, j, k);
                    let want = [i as f32 / 32.0, j as f32 / 32.0, k as f32 / 32.0];
                    for c in 0..3 {
                        assert!(
                            (got[c] - want[c]).abs() < 0.01,
                            "identity mismatch at ({i},{j},{k})[{c}]: got {} want {}",
                            got[c],
                            want[c]
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn srgb_profile_matches_matrix_path_at_neutrals() {
        let icc = Profile::new_srgb().icc().unwrap();
        let floats = build_lut_floats(&icc, LUT_SIZE).unwrap();
        let matrix = rec2020_to_target_matrix(ExportColorSpace::Srgb);
        for &idx in &[4usize, 8, 16, 24, 30] {
            let value = idx as f32 / 32.0;
            let got = sample(&floats, N, idx, idx, idx);
            let (lr, lg, lb) = apply_matrix(&matrix, value, value, value);
            let want = [
                encode_oetf(ExportColorSpace::Srgb, lr),
                encode_oetf(ExportColorSpace::Srgb, lg),
                encode_oetf(ExportColorSpace::Srgb, lb),
            ];
            for c in 0..3 {
                assert!(
                    (got[c] - want[c]).abs() < 0.02,
                    "srgb mismatch at neutral {value}[{c}]: got {} want {}",
                    got[c],
                    want[c]
                );
            }
        }
    }

    #[test]
    fn response_header_carries_size() {
        let floats = build_lut_floats(&rec2020_linear_icc(), LUT_SIZE).unwrap();
        let bytes = encode_response(LUT_SIZE, &floats);
        assert_eq!(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]), LUT_SIZE);
        assert_eq!(bytes.len(), 4 + N * N * N * 3 * 4);
    }

    #[test]
    fn invalid_icc_returns_none() {
        assert!(build_lut_floats(b"not an icc profile", LUT_SIZE).is_none());
    }
}
