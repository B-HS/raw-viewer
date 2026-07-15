use rayon::prelude::*;

use crate::cpurender::color;
use crate::cpurender::luts;
use crate::types::{ColorState, EditState, EffectsState, HslBand, ToneState};

pub const HSL_BAND_CENTERS: [f32; 8] = [0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 280.0, 320.0];
const HSL_BAND_ORDER: [HslBand; 8] = [
    HslBand::Red,
    HslBand::Orange,
    HslBand::Yellow,
    HslBand::Green,
    HslBand::Aqua,
    HslBand::Blue,
    HslBand::Purple,
    HslBand::Magenta,
];
const CLARITY_RADII: [f32; 3] = [8.0, 16.0, 24.0];

pub fn downscale_area(src: &[f32], sw: usize, sh: usize, dw: usize, dh: usize) -> Vec<f32> {
    if dw == sw && dh == sh {
        return src.to_vec();
    }
    let mut dst = vec![0.0f32; dw * dh * 3];
    dst.par_chunks_mut(dw * 3).enumerate().for_each(|(dy, row)| {
        let sy0 = dy * sh / dh;
        let sy1 = ((dy + 1) * sh / dh).max(sy0 + 1).min(sh);
        for dx in 0..dw {
            let sx0 = dx * sw / dw;
            let sx1 = ((dx + 1) * sw / dw).max(sx0 + 1).min(sw);
            let mut sum = [0.0f32; 3];
            let mut count = 0.0f32;
            for sy in sy0..sy1 {
                for sx in sx0..sx1 {
                    let base = (sy * sw + sx) * 3;
                    sum[0] += src[base];
                    sum[1] += src[base + 1];
                    sum[2] += src[base + 2];
                    count += 1.0;
                }
            }
            let inv = if count > 0.0 { 1.0 / count } else { 0.0 };
            row[dx * 3] = sum[0] * inv;
            row[dx * 3 + 1] = sum[1] * inv;
            row[dx * 3 + 2] = sum[2] * inv;
        }
    });
    dst
}

pub fn pass1_wb(buf: &mut [f32], matrix: &[f32; 9], gain: [f32; 3]) {
    buf.par_chunks_mut(3).for_each(|px| {
        let out = color::apply_matrix(matrix, gain[0] * px[0], gain[1] * px[1], gain[2] * px[2]);
        px[0] = out[0];
        px[1] = out[1];
        px[2] = out[2];
    });
}

pub fn pass3_tone(buf: &mut [f32], tone: &ToneState) {
    let exposure = 2.0f32.powf(tone.exposure as f32);
    let recovery = (tone.highlight_recovery / 100.0) as f32;
    let highlights = (tone.highlights / 100.0) as f32;
    let shadows = (tone.shadows / 100.0) as f32;
    let whites = (tone.whites / 100.0) as f32;
    let blacks = (tone.blacks / 100.0) as f32;
    let contrast_k = 2.0f32.powf((tone.contrast / 100.0) as f32);
    let pivot = 0.18f32;
    buf.par_chunks_mut(3).for_each(|px| {
        let mut c = [px[0] * exposure, px[1] * exposure, px[2] * exposure];
        if recovery > 0.0 {
            for channel in &mut c {
                *channel /= 1.0 + recovery * (*channel - 1.0).max(0.0);
            }
        }
        let y = color::luma(c[0], c[1], c[2]);
        let hi = color::smoothstep(0.5, 0.9, y);
        let lo = 1.0 - color::smoothstep(0.1, 0.45, y);
        let gain_hi = (highlights * hi).exp2();
        let gain_lo = (shadows * lo).exp2();
        let white_gain = 1.0 + whites * 0.3 * color::smoothstep(0.3, 1.0, y);
        let black_add = blacks * 0.05 * (1.0 - color::smoothstep(0.0, 0.3, y));
        for channel in &mut c {
            let mut value = *channel * gain_hi * gain_lo;
            value = pivot * (value.max(1e-5) / pivot).powf(contrast_k);
            value = value * white_gain + black_add;
            *channel = value.max(0.0);
        }
        px[0] = c[0];
        px[1] = c[1];
        px[2] = c[2];
    });
}

fn sample_lut(lut: &[f32], u: f32) -> f32 {
    let n = lut.len();
    let pos = (u * n as f32 - 0.5).clamp(0.0, (n - 1) as f32);
    let i0 = pos.floor() as usize;
    let i1 = (i0 + 1).min(n - 1);
    let frac = pos - i0 as f32;
    lut[i0] * (1.0 - frac) + lut[i1] * frac
}

fn sample_lut_strided(lut: &[f32], channel: usize, stride: usize, u: f32) -> f32 {
    let n = lut.len() / stride;
    let pos = (u * n as f32 - 0.5).clamp(0.0, (n - 1) as f32);
    let i0 = pos.floor() as usize;
    let i1 = (i0 + 1).min(n - 1);
    let frac = pos - i0 as f32;
    lut[i0 * stride + channel] * (1.0 - frac) + lut[i1 * stride + channel] * frac
}

pub fn pass4_curve(buf: &mut [f32], base_lut: &[f32; luts::BASE_LUT_SIZE], tone_lut: &[f32]) {
    buf.par_chunks_mut(3).for_each(|px| {
        for (channel, value) in px.iter_mut().enumerate() {
            let e0 = color::srgb_oetf(*value);
            let e1 = sample_lut(base_lut, e0);
            let comp = sample_lut_strided(tone_lut, 3, 4, e1);
            let tch = sample_lut_strided(tone_lut, channel, 4, comp);
            *value = color::srgb_eotf(tch);
        }
    });
}

fn ang_dist(a: f32, b: f32) -> f32 {
    let d = (a - b).abs();
    d.min(360.0 - d)
}

pub fn pass5_color(buf: &mut [f32], color_state: &ColorState) {
    let mut hue = [0.0f32; 8];
    let mut sat = [0.0f32; 8];
    let mut lum = [0.0f32; 8];
    for (i, band) in HSL_BAND_ORDER.iter().enumerate() {
        if let Some(adjust) = color_state.hsl.get(band) {
            hue[i] = (adjust.hue / 100.0) as f32;
            sat[i] = (adjust.sat / 100.0) as f32;
            lum[i] = (adjust.lum / 100.0) as f32;
        }
    }
    let vibrance = (color_state.vibrance / 100.0) as f32;
    let saturation = (color_state.saturation / 100.0) as f32;
    let bw = color_state.bw;
    buf.par_chunks_mut(3).for_each(|px| {
        let c0 = [px[0].max(0.0), px[1].max(0.0), px[2].max(0.0)];
        let hsv = color::rgb2hsv(c0[0], c0[1], c0[2]);
        let deg = hsv[0] * 360.0;
        let mut hue_shift = 0.0f32;
        let mut sat_mul = 0.0f32;
        let mut lum_mul = 0.0f32;
        for i in 0..8 {
            let dist = ang_dist(deg, HSL_BAND_CENTERS[i]);
            let w = if dist < 60.0 { 0.5 * (1.0 + (std::f32::consts::PI * dist / 60.0).cos()) } else { 0.0 };
            hue_shift += w * hue[i];
            sat_mul += w * sat[i];
            lum_mul += w * lum[i];
        }
        let h = color::fract(hsv[0] + hue_shift * (30.0 / 360.0));
        let s = (hsv[1] * (1.0 + sat_mul)).clamp(0.0, 4.0);
        let v = (hsv[2] * (1.0 + lum_mul)).max(0.0);
        let mut c = color::hsv2rgb(h, s, v);
        if bw {
            let g = (color::luma(c[0], c[1], c[2]) * (1.0 + lum_mul)).max(0.0);
            px[0] = g;
            px[1] = g;
            px[2] = g;
            return;
        }
        let y = color::luma(c[0], c[1], c[2]);
        let hv = color::rgb2hsv(c[0].max(0.0), c[1].max(0.0), c[2].max(0.0));
        let protect = ((hv[0] * 360.0 - 35.0).abs() / 20.0).clamp(0.0, 1.0);
        let vib = vibrance * (1.0 - hv[1]) * protect;
        let vib_mix = (1.0 + vib).clamp(0.0, 4.0);
        let sat_mix = (1.0 + saturation).clamp(0.0, 4.0);
        for channel in &mut c {
            let after_vib = y * (1.0 - vib_mix) + *channel * vib_mix;
            *channel = (y * (1.0 - sat_mix) + after_vib * sat_mix).max(0.0);
        }
        px[0] = c[0];
        px[1] = c[1];
        px[2] = c[2];
    });
}

fn hash(vx: f32, vy: f32) -> f32 {
    let px = color::fract(vx * 123.34);
    let py = color::fract(vy * 456.21);
    let d = px * (px + 45.32) + py * (py + 45.32);
    color::fract((px + d) * (py + d))
}

pub fn pass7_effects(src: &[f32], width: usize, height: usize, effects: &EffectsState) -> Vec<f32> {
    let clarity = (effects.clarity / 100.0) as f32;
    let dehaze = (effects.dehaze / 100.0) as f32;
    let vignette_amount = (effects.vignette_amount / 100.0) as f32;
    let vignette_midpoint = effects.vignette_midpoint as f32;
    let vignette_roundness = effects.vignette_roundness as f32;
    let vignette_feather = effects.vignette_feather as f32;
    let grain_amount = (effects.grain_amount / 100.0) as f32;
    let grain_size = effects.grain_size as f32;
    let grain_roughness = effects.grain_roughness as f32;
    let seed = 1.0f32;
    let fw = width as f32;
    let fh = height as f32;
    let sample = |sx: i64, sy: i64, channel: usize| {
        let cx = sx.clamp(0, width as i64 - 1) as usize;
        let cy = sy.clamp(0, height as i64 - 1) as usize;
        src[(cy * width + cx) * 3 + channel]
    };
    let mut dst = vec![0.0f32; width * height * 3];
    dst.par_chunks_mut(width * 3).enumerate().for_each(|(py, row)| {
        for px in 0..width {
            let base = (py * width + px) * 3;
            let mut c = [src[base], src[base + 1], src[base + 2]];
            let mut y = color::luma(c[0], c[1], c[2]);
            if clarity != 0.0 {
                let mut blur = 0.0f32;
                for radius in CLARITY_RADII {
                    let r = radius as i64;
                    let taps = [
                        (px as i64 + r, py as i64),
                        (px as i64 - r, py as i64),
                        (px as i64, py as i64 + r),
                        (px as i64, py as i64 - r),
                    ];
                    for (tx, ty) in taps {
                        blur += color::luma(sample(tx, ty, 0), sample(tx, ty, 1), sample(tx, ty, 2));
                    }
                }
                blur /= 12.0;
                let local = y - blur;
                let mid = (1.0 - (y - 0.4).abs() * 2.0).clamp(0.0, 1.0);
                let yc = y + clarity * local * mid;
                let scale = yc / y.max(1e-4);
                for channel in &mut c {
                    *channel *= scale;
                }
                y = color::luma(c[0], c[1], c[2]);
            }
            if dehaze != 0.0 {
                let dc = c[0].min(c[1]).min(c[2]);
                for channel in &mut c {
                    *channel += dehaze * (*channel - dc) * 0.5;
                }
                let yd = color::luma(c[0], c[1], c[2]);
                let k = 1.0 + dehaze * 0.2;
                for channel in &mut c {
                    *channel = (yd * (1.0 - k) + *channel * k).max(0.0);
                }
            }
            if vignette_amount != 0.0 {
                let dx = (px as f32 + 0.5) / fw - 0.5;
                let dy = (py as f32 + 0.5) / fh - 0.5;
                let linf = dx.abs().max(dy.abs()) * 1.414_213_6;
                let l2 = (dx * dx + dy * dy).sqrt();
                let round_mix = (vignette_roundness + 100.0) / 200.0;
                let rr = linf * (1.0 - round_mix) + l2 * round_mix;
                let mid = vignette_midpoint / 100.0 * 0.7;
                let feather = vignette_feather / 100.0 * 0.6 + 0.02;
                let v = color::smoothstep(mid, mid + feather, rr);
                let strength = if vignette_amount < 0.0 { 1.0 } else { 0.6 };
                let factor = 1.0 + vignette_amount * v * strength;
                for channel in &mut c {
                    *channel = (*channel * factor).max(0.0);
                }
            }
            if grain_amount != 0.0 {
                let gpx = px as f32 + 0.5;
                let gpy = py as f32 + 0.5;
                let scale = 0.5 + (4.0 - 0.5) * (grain_size / 100.0);
                let fbx = (gpx / scale).floor();
                let fby = (gpy / scale).floor();
                let n = hash(fbx + seed, fby + seed);
                let n2 = hash(fbx * 1.7 + seed * 2.0, fby * 1.7 + seed * 2.0);
                let grain = (n * (1.0 - grain_roughness / 100.0) + n2 * (grain_roughness / 100.0)) - 0.5;
                for channel in &mut c {
                    *channel = (*channel + grain * grain_amount * 0.2).max(0.0);
                }
            }
            row[px * 3] = c[0];
            row[px * 3 + 1] = c[1];
            row[px * 3 + 2] = c[2];
        }
    });
    dst
}

pub fn pass8_output(src: &[f32]) -> Vec<u8> {
    let mut out = vec![0u8; src.len() / 3 * 4];
    out.par_chunks_mut(4).zip(src.par_chunks(3)).for_each(|(rgba, lin)| {
        let display = color::apply_matrix(&color::REC2020_TO_SRGB, lin[0], lin[1], lin[2]);
        rgba[0] = (color::srgb_oetf(display[0]) * 255.0 + 0.5) as u8;
        rgba[1] = (color::srgb_oetf(display[1]) * 255.0 + 0.5) as u8;
        rgba[2] = (color::srgb_oetf(display[2]) * 255.0 + 0.5) as u8;
        rgba[3] = 255;
    });
    out
}

// SPEC-GAP: pass2 (geometry/lens) and pass6 (NR/sharpen) are skipped in the v1 CPU fallback (PRD §3.4 ②/⑥); pass8 clip/crop/split display overlays are skipped (interactive display only). The CPU frame carries the same stage-skipping as the GPU (PRD §3.4) so the default standard-base-curve state runs ①→④→⑧.
pub fn render_passes(src: Vec<f32>, width: usize, height: usize, matrix: &[f32; 9], state: &EditState) -> Vec<u8> {
    let gains = luts::wb_gains(state.wb.temp, state.wb.tint, state.wb.temp_shift);
    let mut buf = src;
    pass1_wb(&mut buf, matrix, [gains[0] as f32, gains[1] as f32, gains[2] as f32]);
    if !luts::is_tone_neutral(&state.tone) {
        pass3_tone(&mut buf, &state.tone);
    }
    if luts::is_curve_active(state) {
        let base_u8 = luts::build_base_curve_lut(state.base_curve);
        let mut base_lut = [0.0f32; luts::BASE_LUT_SIZE];
        for (slot, value) in base_lut.iter_mut().zip(base_u8.iter()) {
            *slot = *value as f32 / 255.0;
        }
        let tone_lut = luts::tone_lut_f32(&luts::build_tone_curve_lut(&state.curves));
        pass4_curve(&mut buf, &base_lut, &tone_lut);
    }
    if luts::is_color_active(&state.color) {
        pass5_color(&mut buf, &state.color);
    }
    if luts::is_effects_active(&state.effects) {
        buf = pass7_effects(&buf, width, height, &state.effects);
    }
    pass8_output(&buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edit::defaults::default_edit_state;
    use crate::cpurender::color;

    fn gray_source(width: usize, height: usize, value: f32) -> Vec<f32> {
        vec![value; width * height * 3]
    }

    #[test]
    fn downscale_area_halves_and_averages() {
        let src = vec![
            0.0, 0.0, 0.0, 1.0, 1.0, 1.0, //
            1.0, 1.0, 1.0, 0.0, 0.0, 0.0,
        ];
        let out = downscale_area(&src, 2, 2, 1, 1);
        assert_eq!(out.len(), 3);
        assert!((out[0] - 0.5).abs() < 1e-6);
    }

    #[test]
    fn default_state_renders_via_standard_base_curve() {
        let state = default_edit_state();
        let src = gray_source(8, 8, 0.18);
        let rgba = render_passes(src, 8, 8, &color::IDENTITY3, &state);
        assert_eq!(rgba.len(), 8 * 8 * 4);
        assert_eq!(rgba[3], 255);
        assert!(rgba[0] > 0 && rgba[0] < 255, "mid-gray should map inside range, got {}", rgba[0]);
        assert_eq!(rgba[0], rgba[1]);
    }

    #[test]
    fn exposure_up_brightens_output() {
        let mut dark = default_edit_state();
        dark.tone.exposure = 0.0;
        let base = render_passes(gray_source(4, 4, 0.1), 4, 4, &color::IDENTITY3, &dark)[0];
        let mut bright = default_edit_state();
        bright.tone.exposure = 1.0;
        let lifted = render_passes(gray_source(4, 4, 0.1), 4, 4, &color::IDENTITY3, &bright)[0];
        assert!(lifted > base, "exposure +1 should brighten: {lifted} vs {base}");
    }

    #[test]
    fn render_is_deterministic() {
        let state = default_edit_state();
        let a = render_passes(gray_source(16, 12, 0.3), 16, 12, &color::IDENTITY3, &state);
        let b = render_passes(gray_source(16, 12, 0.3), 16, 12, &color::IDENTITY3, &state);
        assert_eq!(a, b);
    }

    #[test]
    fn bw_output_is_neutral_gray() {
        let mut state = default_edit_state();
        state.color.bw = true;
        let rgba = render_passes(vec![0.6, 0.2, 0.1, 0.6, 0.2, 0.1], 2, 1, &color::IDENTITY3, &state);
        assert_eq!(rgba[0], rgba[1]);
        assert_eq!(rgba[1], rgba[2]);
    }
}
