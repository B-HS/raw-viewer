use crate::color::{REC2020_FROM_XYZ_D65, XYZ_FROM_SRGB_LINEAR};
use crate::types_export::ExportColorSpace;

type Mat3 = [[f32; 3]; 3];

const XYZ_FROM_DISPLAY_P3_D65: Mat3 = [
    [0.486_570_95, 0.265_667_7, 0.198_217_28],
    [0.228_974_56, 0.691_738_5, 0.079_286_91],
    [0.0, 0.045_113_38, 1.043_944_4],
];

const XYZ_FROM_ADOBE_RGB_D65: Mat3 = [
    [0.576_669_04, 0.185_558_24, 0.188_228_65],
    [0.297_344_98, 0.627_363_57, 0.075_291_46],
    [0.027_031_36, 0.070_688_85, 0.991_337_54],
];

const XYZ_FROM_PROPHOTO_D50: Mat3 = [
    [0.797_674_9, 0.135_191_7, 0.031_353_4],
    [0.288_040_2, 0.711_874_1, 0.000_085_7],
    [0.0, 0.0, 0.825_21],
];

const BRADFORD_D65_TO_D50: Mat3 = [
    [1.047_811_2, 0.022_886_6, -0.050_127_0],
    [0.029_542_4, 0.990_484_4, -0.017_049_1],
    [-0.009_234_5, 0.015_043_6, 0.752_131_6],
];

fn invert3(m: &Mat3) -> Option<Mat3> {
    let (a, b, c) = (m[0][0], m[0][1], m[0][2]);
    let (d, e, f) = (m[1][0], m[1][1], m[1][2]);
    let (g, h, i) = (m[2][0], m[2][1], m[2][2]);
    let det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if det == 0.0 || !det.is_finite() {
        return None;
    }
    let inv = 1.0 / det;
    let out = [
        [(e * i - f * h) * inv, (c * h - b * i) * inv, (b * f - c * e) * inv],
        [(f * g - d * i) * inv, (a * i - c * g) * inv, (c * d - a * f) * inv],
        [(d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv],
    ];
    Some(out)
}

fn matmul3(a: &Mat3, b: &Mat3) -> Mat3 {
    let mut out = [[0.0f32; 3]; 3];
    for r in 0..3 {
        for c in 0..3 {
            let mut sum = 0.0f32;
            for k in 0..3 {
                sum += a[r][k] * b[k][c];
            }
            out[r][c] = sum;
        }
    }
    out
}

fn identity() -> Mat3 {
    [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
}

pub fn rec2020_to_target_matrix(space: ExportColorSpace) -> Mat3 {
    let xyz_from_rec2020 = invert3(&REC2020_FROM_XYZ_D65).unwrap_or_else(identity);
    match space {
        ExportColorSpace::Rec2020 => identity(),
        ExportColorSpace::Srgb => {
            let srgb_from_xyz = invert3(&XYZ_FROM_SRGB_LINEAR).unwrap_or_else(identity);
            matmul3(&srgb_from_xyz, &xyz_from_rec2020)
        }
        ExportColorSpace::DisplayP3 => {
            let p3_from_xyz = invert3(&XYZ_FROM_DISPLAY_P3_D65).unwrap_or_else(identity);
            matmul3(&p3_from_xyz, &xyz_from_rec2020)
        }
        ExportColorSpace::AdobeRgb => {
            let adobe_from_xyz = invert3(&XYZ_FROM_ADOBE_RGB_D65).unwrap_or_else(identity);
            matmul3(&adobe_from_xyz, &xyz_from_rec2020)
        }
        ExportColorSpace::Prophoto => {
            let prophoto_from_xyz = invert3(&XYZ_FROM_PROPHOTO_D50).unwrap_or_else(identity);
            let adapted = matmul3(&BRADFORD_D65_TO_D50, &xyz_from_rec2020);
            matmul3(&prophoto_from_xyz, &adapted)
        }
    }
}

pub fn apply_matrix(m: &Mat3, r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    (
        m[0][0] * r + m[0][1] * g + m[0][2] * b,
        m[1][0] * r + m[1][1] * g + m[1][2] * b,
        m[2][0] * r + m[2][1] * g + m[2][2] * b,
    )
}

fn srgb_oetf(x: f32) -> f32 {
    let x = x.clamp(0.0, 1.0);
    if x <= 0.003_130_8 {
        12.92 * x
    } else {
        1.055 * x.powf(1.0 / 2.4) - 0.055
    }
}

fn gamma_oetf(x: f32, gamma: f32) -> f32 {
    x.clamp(0.0, 1.0).powf(1.0 / gamma)
}

pub fn encode_oetf(space: ExportColorSpace, x: f32) -> f32 {
    match space {
        // SPEC-GAP: rec2020 export uses the sRGB transfer curve (not BT.2020 OETF); the embedded ICC TRC matches so the file is self-consistent.
        ExportColorSpace::Srgb | ExportColorSpace::DisplayP3 | ExportColorSpace::Rec2020 => srgb_oetf(x),
        // SPEC-GAP: adobe-rgb uses pure gamma 2.2 (Adobe RGB 1998 is ~2.19921875).
        ExportColorSpace::AdobeRgb => gamma_oetf(x, 2.2),
        // SPEC-GAP: prophoto uses pure gamma 1.8 without the ROMM linear toe.
        ExportColorSpace::Prophoto => gamma_oetf(x, 1.8),
    }
}

pub fn quantize_u8(x: f32) -> u8 {
    (x.clamp(0.0, 1.0) * 255.0 + 0.5) as u8
}

pub fn quantize_u16(x: f32) -> u16 {
    (x.clamp(0.0, 1.0) * 65535.0 + 0.5) as u16
}

#[cfg(test)]
mod tests {
    use super::*;

    fn white_maps_to_white(space: ExportColorSpace) {
        let m = rec2020_to_target_matrix(space);
        let (r, g, b) = apply_matrix(&m, 1.0, 1.0, 1.0);
        assert!((r - 1.0).abs() < 2e-3, "{space:?} r={r}");
        assert!((g - 1.0).abs() < 2e-3, "{space:?} g={g}");
        assert!((b - 1.0).abs() < 2e-3, "{space:?} b={b}");
    }

    #[test]
    fn neutral_white_is_preserved_for_all_spaces() {
        white_maps_to_white(ExportColorSpace::Srgb);
        white_maps_to_white(ExportColorSpace::DisplayP3);
        white_maps_to_white(ExportColorSpace::Rec2020);
        white_maps_to_white(ExportColorSpace::AdobeRgb);
        white_maps_to_white(ExportColorSpace::Prophoto);
    }

    #[test]
    fn rec2020_target_is_identity() {
        let m = rec2020_to_target_matrix(ExportColorSpace::Rec2020);
        let (r, g, b) = apply_matrix(&m, 0.2, 0.5, 0.9);
        assert!((r - 0.2).abs() < 1e-6 && (g - 0.5).abs() < 1e-6 && (b - 0.9).abs() < 1e-6);
    }

    #[test]
    fn srgb_oetf_endpoints_and_midpoint() {
        assert!((srgb_oetf(0.0)).abs() < 1e-6);
        assert!((srgb_oetf(1.0) - 1.0).abs() < 1e-6);
        assert!((srgb_oetf(0.5) - 0.735_356_9).abs() < 1e-3);
    }

    #[test]
    fn oetf_clamps_out_of_range() {
        assert_eq!(encode_oetf(ExportColorSpace::Srgb, -1.0), 0.0);
        assert!((encode_oetf(ExportColorSpace::Srgb, 4.0) - 1.0).abs() < 1e-6);
        assert!((encode_oetf(ExportColorSpace::Prophoto, 1.0) - 1.0).abs() < 1e-6);
        assert_eq!(encode_oetf(ExportColorSpace::AdobeRgb, 0.0), 0.0);
    }

    #[test]
    fn quantize_bounds() {
        assert_eq!(quantize_u8(-0.5), 0);
        assert_eq!(quantize_u8(1.5), 255);
        assert_eq!(quantize_u8(1.0), 255);
        assert_eq!(quantize_u16(0.0), 0);
        assert_eq!(quantize_u16(1.0), 65535);
    }

    #[test]
    fn srgb_primaries_map_into_unit_range() {
        let m = rec2020_to_target_matrix(ExportColorSpace::Srgb);
        let (r, g, b) = apply_matrix(&m, 0.5, 0.5, 0.5);
        assert!(r.is_finite() && g.is_finite() && b.is_finite());
        assert!((r - 0.5).abs() < 2e-3 && (g - 0.5).abs() < 2e-3 && (b - 0.5).abs() < 2e-3);
    }
}
