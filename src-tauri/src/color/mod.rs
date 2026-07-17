pub mod display_lut;

pub const REC2020_FROM_XYZ_D65: [[f32; 3]; 3] = [
    [1.716_651_2, -0.355_670_8, -0.253_366_3],
    [-0.666_684_3, 1.616_481_2, 0.015_768_546],
    [0.017_639_857, -0.042_770_613, 0.942_103_12],
];

pub const XYZ_FROM_SRGB_LINEAR: [[f32; 3]; 3] = [
    [0.412_390_8, 0.357_584_34, 0.180_480_8],
    [0.212_639, 0.715_168_7, 0.072_192_32],
    [0.019_330_818, 0.119_194_78, 0.950_532_15],
];

const D65_WHITE_XYZ: [f32; 3] = [0.950_47, 1.0, 1.088_83];

fn invert3(m: &[[f32; 3]; 3]) -> Option<[[f32; 3]; 3]> {
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
    if all_finite(&out) {
        Some(out)
    } else {
        None
    }
}

fn matmul3(a: &[[f32; 3]; 3], b: &[[f32; 3]; 3]) -> [[f32; 3]; 3] {
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

fn matvec3(m: &[[f32; 3]; 3], v: &[f32; 3]) -> [f32; 3] {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
}

fn flatten(m: &[[f32; 3]; 3]) -> [f32; 9] {
    [m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], m[2][0], m[2][1], m[2][2]]
}

fn all_finite(m: &[[f32; 3]; 3]) -> bool {
    m.iter().all(|row| row.iter().all(|value| value.is_finite()))
}

pub fn srgb_eotf(x: f32) -> f32 {
    if x <= 0.040_45 {
        x / 12.92
    } else {
        ((x + 0.055) / 1.055).powf(2.4)
    }
}

pub fn rec2020_from_srgb_linear_matrix() -> [f32; 9] {
    flatten(&matmul3(&REC2020_FROM_XYZ_D65, &XYZ_FROM_SRGB_LINEAR))
}

pub fn cam_to_rec2020(cam_xyz: &[[f32; 3]; 3]) -> Option<[f32; 9]> {
    let xyz_from_cam = invert3(cam_xyz)?;
    let channel_gain = matvec3(cam_xyz, &D65_WHITE_XYZ);
    let mut cam_to_xyz = xyz_from_cam;
    for row in &mut cam_to_xyz {
        for c in 0..3 {
            row[c] *= channel_gain[c];
        }
    }
    let out = matmul3(&REC2020_FROM_XYZ_D65, &cam_to_xyz);
    if all_finite(&out) {
        Some(flatten(&out))
    } else {
        None
    }
}

pub fn rec2020_from_rgb_cam(rgb_cam: &[[f32; 3]; 3]) -> Option<[f32; 9]> {
    let rec2020_from_srgb_linear = matmul3(&REC2020_FROM_XYZ_D65, &XYZ_FROM_SRGB_LINEAR);
    let out = matmul3(&rec2020_from_srgb_linear, rgb_cam);
    if all_finite(&out) {
        Some(flatten(&out))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CAM_XYZ_5D3: [[f32; 3]; 3] = [
        [0.6722, -0.0635, -0.0963],
        [-0.4287, 1.2460, 0.2028],
        [-0.0908, 0.2162, 0.5668],
    ];

    #[test]
    fn invert3_roundtrips_to_identity() {
        let inv = invert3(&CAM_XYZ_5D3);
        assert!(inv.is_some());
        if let Some(inv) = inv {
            let product = matmul3(&CAM_XYZ_5D3, &inv);
            for (r, row) in product.iter().enumerate() {
                for (c, value) in row.iter().enumerate() {
                    let expected = if r == c { 1.0 } else { 0.0 };
                    assert!((value - expected).abs() < 1e-3, "identity mismatch at {r},{c}: {value}");
                }
            }
        }
    }

    #[test]
    fn zero_matrix_is_not_invertible() {
        assert!(invert3(&[[0.0; 3]; 3]).is_none());
    }

    #[test]
    fn cam_to_rec2020_is_finite() {
        let matrix = cam_to_rec2020(&CAM_XYZ_5D3);
        assert!(matrix.is_some());
        if let Some(matrix) = matrix {
            assert!(matrix.iter().all(|value| value.is_finite()));
        }
    }

    #[test]
    fn cam_neutral_maps_to_rec2020_white() {
        let matrix = cam_to_rec2020(&CAM_XYZ_5D3);
        assert!(matrix.is_some());
        if let Some(m) = matrix {
            let white = [m[0] + m[1] + m[2], m[3] + m[4] + m[5], m[6] + m[7] + m[8]];
            for channel in white {
                assert!((channel - 1.0).abs() < 1e-3, "white not preserved: {white:?}");
            }
        }
    }

    #[test]
    fn rec2020_white_is_unit() {
        let white = matvec3(&REC2020_FROM_XYZ_D65, &D65_WHITE_XYZ);
        for channel in white {
            assert!((channel - 1.0).abs() < 1e-3, "rec2020 white not unit: {white:?}");
        }
    }

    #[test]
    fn rgb_cam_fallback_is_finite() {
        let rgb_cam = [[1.9, -0.9, 0.0], [-0.2, 1.5, -0.3], [0.0, -0.4, 1.4]];
        let matrix = rec2020_from_rgb_cam(&rgb_cam);
        assert!(matrix.is_some());
        if let Some(matrix) = matrix {
            assert!(matrix.iter().all(|value| value.is_finite()));
        }
    }
}
