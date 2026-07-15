use half::f16;

use crate::types::{BaseCurveMode, ColorState, CurvePoint, CurvesState, EditState, EffectsState, ToneState};

pub const TONE_LUT_SIZE: usize = 1024;
pub const BASE_LUT_SIZE: usize = 256;

const WARMTH_STRENGTH: f64 = 0.3;
const TINT_STRENGTH: f64 = 0.5;
const WB_REFERENCE_KELVIN: f64 = 6500.0;
const WB_MIN_KELVIN: f64 = 2000.0;
const WB_MAX_KELVIN: f64 = 50000.0;

pub fn wb_gains(temp: f64, tint: f64, temp_shift: Option<f64>) -> [f64; 3] {
    let warmth = match temp_shift {
        Some(shift) => (shift / 100.0) * 1.5,
        None => (temp.clamp(WB_MIN_KELVIN, WB_MAX_KELVIN) / WB_REFERENCE_KELVIN).log2(),
    };
    let red = 2.0f64.powf(WARMTH_STRENGTH * warmth);
    let blue = 2.0f64.powf(-WARMTH_STRENGTH * warmth);
    let green = 2.0f64.powf((-tint / 150.0) * TINT_STRENGTH);
    [red, green, blue]
}

pub fn pack_half_trunc(value: f32) -> u16 {
    let bits = value.to_bits();
    let sign = ((bits >> 16) & 0x8000) as u16;
    let mut mantissa = bits & 0x007f_ffff;
    let exponent_raw = (bits >> 23) & 0xff;
    if exponent_raw == 0xff {
        return sign | 0x7c00 | if mantissa != 0 { 0x0200 } else { 0 };
    }
    let exponent = exponent_raw as i32 - 127 + 15;
    if exponent >= 31 {
        return sign | 0x7c00;
    }
    if exponent <= 0 {
        if exponent < -10 {
            return sign;
        }
        mantissa |= 0x0080_0000;
        let shifted = mantissa >> (1 - exponent);
        return sign | ((shifted >> 13) as u16);
    }
    sign | ((exponent as u16) << 10) | ((mantissa >> 13) as u16)
}

pub fn half_to_f32(bits: u16) -> f32 {
    f16::from_bits(bits).to_f32()
}

fn base_control(mode: BaseCurveMode) -> (Vec<f64>, Vec<f64>) {
    match mode {
        BaseCurveMode::Linear => (vec![0.0, 1.0], vec![0.0, 1.0]),
        BaseCurveMode::Standard | BaseCurveMode::CameraMatch => (vec![0.0, 0.25, 0.5, 0.75, 1.0], vec![0.0, 0.22, 0.5, 0.78, 1.0]),
        BaseCurveMode::Filmic => (vec![0.0, 0.2, 0.5, 0.8, 1.0], vec![0.0, 0.12, 0.5, 0.86, 0.98]),
    }
}

fn fritsch_carlson(secant: &[f64], slope: &mut [f64]) {
    let count = slope.len();
    for i in 0..count - 1 {
        if secant[i] == 0.0 {
            slope[i] = 0.0;
            slope[i + 1] = 0.0;
            continue;
        }
        let alpha = slope[i] / secant[i];
        let beta = slope[i + 1] / secant[i];
        let magnitude = alpha * alpha + beta * beta;
        if magnitude > 9.0 {
            let tau = 3.0 / magnitude.sqrt();
            slope[i] = tau * alpha * secant[i];
            slope[i + 1] = tau * beta * secant[i];
        }
    }
}

fn hermite(t: f64) -> (f64, f64, f64, f64) {
    let t2 = t * t;
    let t3 = t2 * t;
    (2.0 * t3 - 3.0 * t2 + 1.0, t3 - 2.0 * t2 + t, -2.0 * t3 + 3.0 * t2, t3 - t2)
}

pub fn build_base_curve_lut(mode: BaseCurveMode) -> [u8; BASE_LUT_SIZE] {
    let (control_x, control_y) = base_control(mode);
    let count = control_x.len();
    let mut lut = [0u8; BASE_LUT_SIZE];
    if count < 2 {
        for (i, slot) in lut.iter_mut().enumerate() {
            *slot = ((i as f64 / (BASE_LUT_SIZE as f64 - 1.0)) * 255.0).round() as u8;
        }
        return lut;
    }
    let mut secant = vec![0.0f64; count - 1];
    for i in 0..count - 1 {
        secant[i] = (control_y[i + 1] - control_y[i]) / (control_x[i + 1] - control_x[i]);
    }
    let mut slope = vec![0.0f64; count];
    slope[0] = secant[0];
    slope[count - 1] = secant[count - 2];
    for i in 1..count - 1 {
        slope[i] = (secant[i - 1] + secant[i]) / 2.0;
    }
    fritsch_carlson(&secant, &mut slope);
    let mut segment = 0usize;
    for (i, slot) in lut.iter_mut().enumerate() {
        let x = i as f64 / (BASE_LUT_SIZE as f64 - 1.0);
        while segment < count - 2 && x > control_x[segment + 1] {
            segment += 1;
        }
        let width = control_x[segment + 1] - control_x[segment];
        let t = (x - control_x[segment]) / width;
        let (h00, h10, h01, h11) = hermite(t);
        let y = h00 * control_y[segment] + h10 * width * slope[segment] + h01 * control_y[segment + 1] + h11 * width * slope[segment + 1];
        *slot = (y.clamp(0.0, 1.0) * 255.0).round() as u8;
    }
    lut
}

fn is_identity(points: &[CurvePoint]) -> bool {
    points.len() == 2 && points[0].x == 0.0 && points[0].y == 0.0 && points[1].x == 1.0 && points[1].y == 1.0
}

fn sample_monotone(points: &[CurvePoint], out: &mut [f32], channel: usize, stride: usize) {
    let mut sorted: Vec<CurvePoint> = points.to_vec();
    sorted.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));
    let count = sorted.len();
    if count < 2 || is_identity(&sorted) {
        for i in 0..TONE_LUT_SIZE {
            out[i * stride + channel] = (i as f64 / (TONE_LUT_SIZE as f64 - 1.0)) as f32;
        }
        return;
    }
    let xs: Vec<f64> = sorted.iter().map(|p| p.x).collect();
    let ys: Vec<f64> = sorted.iter().map(|p| p.y).collect();
    let mut secant = vec![0.0f64; count - 1];
    for i in 0..count - 1 {
        let dx = xs[i + 1] - xs[i];
        secant[i] = if dx > 1e-6 { (ys[i + 1] - ys[i]) / dx } else { 0.0 };
    }
    let mut slope = vec![0.0f64; count];
    slope[0] = secant[0];
    slope[count - 1] = secant[count - 2];
    for i in 1..count - 1 {
        slope[i] = (secant[i - 1] + secant[i]) / 2.0;
    }
    fritsch_carlson(&secant, &mut slope);
    let mut segment = 0usize;
    for i in 0..TONE_LUT_SIZE {
        let x = i as f64 / (TONE_LUT_SIZE as f64 - 1.0);
        while segment < count - 2 && x > xs[segment + 1] {
            segment += 1;
        }
        let width = xs[segment + 1] - xs[segment];
        let t = if width > 1e-6 { (x - xs[segment]) / width } else { 0.0 };
        let (h00, h10, h01, h11) = hermite(t);
        let y = h00 * ys[segment] + h10 * width * slope[segment] + h01 * ys[segment + 1] + h11 * width * slope[segment + 1];
        out[i * stride + channel] = y.clamp(0.0, 1.0) as f32;
    }
}

pub fn build_tone_curve_lut(curves: &CurvesState) -> Vec<u16> {
    let mut values = vec![0.0f32; TONE_LUT_SIZE * 4];
    sample_monotone(&curves.red, &mut values, 0, 4);
    sample_monotone(&curves.green, &mut values, 1, 4);
    sample_monotone(&curves.blue, &mut values, 2, 4);
    sample_monotone(&curves.rgb, &mut values, 3, 4);
    values.iter().map(|value| pack_half_trunc(*value)).collect()
}

pub fn tone_lut_f32(packed: &[u16]) -> Vec<f32> {
    packed.iter().map(|bits| half_to_f32(*bits)).collect()
}

pub fn is_curves_neutral(curves: &CurvesState) -> bool {
    is_identity(&curves.rgb) && is_identity(&curves.red) && is_identity(&curves.green) && is_identity(&curves.blue)
}

pub fn is_tone_neutral(tone: &ToneState) -> bool {
    tone.exposure == 0.0
        && tone.contrast == 0.0
        && tone.highlights == 0.0
        && tone.shadows == 0.0
        && tone.whites == 0.0
        && tone.blacks == 0.0
        && tone.highlight_recovery == 0.0
}

pub fn is_curve_active(state: &EditState) -> bool {
    state.base_curve != BaseCurveMode::Linear || !is_curves_neutral(&state.curves)
}

pub fn is_color_active(color: &ColorState) -> bool {
    if color.vibrance != 0.0 || color.saturation != 0.0 || color.bw {
        return true;
    }
    color.hsl.values().any(|adjust| adjust.hue != 0.0 || adjust.sat != 0.0 || adjust.lum != 0.0)
}

pub fn is_effects_active(effects: &EffectsState) -> bool {
    effects.clarity != 0.0 || effects.dehaze != 0.0 || effects.vignette_amount != 0.0 || effects.grain_amount != 0.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pack_half_trunc_matches_known_values() {
        assert_eq!(pack_half_trunc(0.0), 0x0000);
        assert_eq!(pack_half_trunc(1.0), 0x3c00);
        assert_eq!(pack_half_trunc(0.5), 0x3800);
        assert_eq!(pack_half_trunc(1.0 / 1023.0), 5121);
    }

    #[test]
    fn base_curve_linear_is_ramp() {
        let lut = build_base_curve_lut(BaseCurveMode::Linear);
        assert_eq!(lut[0], 0);
        assert_eq!(lut[128], 128);
        assert_eq!(lut[255], 255);
    }

    #[test]
    fn base_curve_standard_lifts_midtones_symmetrically() {
        let lut = build_base_curve_lut(BaseCurveMode::Standard);
        assert_eq!(lut[0], 0);
        assert_eq!(lut[128], 128);
        assert_eq!(lut[255], 255);
    }

    #[test]
    fn tone_identity_roundtrips_through_half() {
        let curves = CurvesState {
            rgb: vec![CurvePoint { x: 0.0, y: 0.0 }, CurvePoint { x: 1.0, y: 1.0 }],
            red: vec![CurvePoint { x: 0.0, y: 0.0 }, CurvePoint { x: 1.0, y: 1.0 }],
            green: vec![CurvePoint { x: 0.0, y: 0.0 }, CurvePoint { x: 1.0, y: 1.0 }],
            blue: vec![CurvePoint { x: 0.0, y: 0.0 }, CurvePoint { x: 1.0, y: 1.0 }],
        };
        let lut = build_tone_curve_lut(&curves);
        assert_eq!(lut.len(), TONE_LUT_SIZE * 4);
        assert_eq!(lut[0], 0);
        assert_eq!(lut[4], 5121);
        let f = tone_lut_f32(&lut);
        assert!((f[(TONE_LUT_SIZE - 1) * 4 + 3] - 1.0).abs() < 1e-3);
    }

    #[test]
    fn wb_neutral_is_unit_gain() {
        let gains = wb_gains(6500.0, 0.0, None);
        for channel in gains {
            assert!((channel - 1.0).abs() < 1e-9);
        }
    }
}
