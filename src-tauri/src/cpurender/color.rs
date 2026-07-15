pub const REC2020_LUMA: [f32; 3] = [0.2627, 0.678, 0.0593];

pub const REC2020_TO_SRGB: [f32; 9] = [
    1.660491, -0.58764114, -0.07284986, -0.12455047, 1.1328999, -0.00834942, -0.01815076, -0.1005789, 1.11872966,
];

pub const REC2020_TO_P3: [f32; 9] = [
    1.34357825, -0.28217967, -0.06139858, -0.06529745, 1.07578792, -0.01049046, 0.00282179, -0.01959849, 1.01677671,
];

pub const SRGB_TO_P3: [f32; 9] = [
    0.82246197, 0.17753803, 0.0, 0.0331942, 0.9668058, 0.0, 0.01708263, 0.07239744, 0.91051993,
];

pub const IDENTITY3: [f32; 9] = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];

pub fn apply_matrix(m: &[f32; 9], r: f32, g: f32, b: f32) -> [f32; 3] {
    [
        m[0] * r + m[1] * g + m[2] * b,
        m[3] * r + m[4] * g + m[5] * b,
        m[6] * r + m[7] * g + m[8] * b,
    ]
}

pub fn luma(r: f32, g: f32, b: f32) -> f32 {
    REC2020_LUMA[0] * r + REC2020_LUMA[1] * g + REC2020_LUMA[2] * b
}

pub fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

pub fn srgb_oetf(x: f32) -> f32 {
    let x = x.clamp(0.0, 1.0);
    if x <= 0.003_130_8 {
        x * 12.92
    } else {
        1.055 * x.powf(1.0 / 2.4) - 0.055
    }
}

pub fn srgb_eotf(x: f32) -> f32 {
    if x <= 0.040_45 {
        x / 12.92
    } else {
        ((x + 0.055) / 1.055).powf(2.4)
    }
}

pub fn fract(x: f32) -> f32 {
    x - x.floor()
}

pub fn rgb2hsv(r: f32, g: f32, b: f32) -> [f32; 3] {
    let k = [0.0f32, -1.0 / 3.0, 2.0 / 3.0, -1.0];
    let (px, py, pz, pw) = if g >= b { (g, b, k[0], k[1]) } else { (b, g, k[3], k[2]) };
    let (qx, qy, qz, qw) = if r >= px { (r, py, pz, px) } else { (px, py, pw, r) };
    let d = qx - qy.min(qw);
    let e = 1.0e-10;
    let h = (qz + (qw - qy) / (6.0 * d + e)).abs();
    let s = d / (qx + e);
    [h, s, qx]
}

pub fn hsv2rgb(h: f32, s: f32, v: f32) -> [f32; 3] {
    let kx = 1.0f32;
    let ky = 2.0 / 3.0;
    let kz = 1.0 / 3.0;
    let px = (fract(h + kx) * 6.0 - 3.0).abs();
    let py = (fract(h + ky) * 6.0 - 3.0).abs();
    let pz = (fract(h + kz) * 6.0 - 3.0).abs();
    let mix = |edge: f32, p: f32| edge * (1.0 - s) + (p - 1.0).clamp(0.0, 1.0) * s;
    [v * mix(1.0, px), v * mix(1.0, py), v * mix(1.0, pz)]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn srgb_transfer_endpoints_and_roundtrip() {
        assert!(srgb_oetf(0.0).abs() < 1e-6);
        assert!((srgb_oetf(1.0) - 1.0).abs() < 1e-6);
        assert!((srgb_oetf(0.5) - 0.735_356_9).abs() < 1e-3);
        for x in [0.0f32, 0.05, 0.2, 0.5, 0.8, 1.0] {
            assert!((srgb_eotf(srgb_oetf(x)) - x).abs() < 1e-4, "roundtrip {x}");
        }
    }

    #[test]
    fn smoothstep_matches_glsl_shape() {
        assert_eq!(smoothstep(0.0, 1.0, -0.5), 0.0);
        assert_eq!(smoothstep(0.0, 1.0, 1.5), 1.0);
        assert!((smoothstep(0.0, 1.0, 0.5) - 0.5).abs() < 1e-6);
    }

    #[test]
    fn hsv_roundtrip_is_stable_for_saturated_colors() {
        for (r, g, b) in [(0.9f32, 0.2, 0.1), (0.1, 0.7, 0.3), (0.2, 0.3, 0.95), (0.5, 0.5, 0.5)] {
            let hsv = rgb2hsv(r, g, b);
            let back = hsv2rgb(hsv[0], hsv[1], hsv[2]);
            assert!((back[0] - r).abs() < 1e-3 && (back[1] - g).abs() < 1e-3 && (back[2] - b).abs() < 1e-3, "roundtrip {r},{g},{b} -> {back:?}");
        }
    }

    #[test]
    fn luma_neutral_is_unit_sum() {
        assert!((luma(1.0, 1.0, 1.0) - 1.0).abs() < 1e-6);
    }
}
