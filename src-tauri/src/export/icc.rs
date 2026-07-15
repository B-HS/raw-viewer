use lcms2::{CIExyY, CIExyYTRIPLE, Profile, ToneCurve};

use crate::types_export::ExportColorSpace;

fn xy(x: f64, y: f64) -> CIExyY {
    CIExyY { x, y, Y: 1.0 }
}

const WHITE_D65: (f64, f64) = (0.312_7, 0.329_0);
const WHITE_D50: (f64, f64) = (0.345_67, 0.358_50);

fn white_point(space: ExportColorSpace) -> CIExyY {
    let (x, y) = match space {
        ExportColorSpace::Prophoto => WHITE_D50,
        _ => WHITE_D65,
    };
    xy(x, y)
}

fn primaries(space: ExportColorSpace) -> CIExyYTRIPLE {
    let (red, green, blue) = match space {
        ExportColorSpace::Srgb => ((0.640, 0.330), (0.300, 0.600), (0.150, 0.060)),
        ExportColorSpace::DisplayP3 => ((0.680, 0.320), (0.265, 0.690), (0.150, 0.060)),
        ExportColorSpace::Rec2020 => ((0.708, 0.292), (0.170, 0.797), (0.131, 0.046)),
        ExportColorSpace::AdobeRgb => ((0.640, 0.330), (0.210, 0.710), (0.150, 0.060)),
        ExportColorSpace::Prophoto => ((0.734_699, 0.265_301), (0.159_597, 0.840_403), (0.036_598, 0.000_105)),
    };
    CIExyYTRIPLE {
        Red: xy(red.0, red.1),
        Green: xy(green.0, green.1),
        Blue: xy(blue.0, blue.1),
    }
}

fn tone_curve(space: ExportColorSpace) -> ToneCurve {
    match space {
        ExportColorSpace::Srgb | ExportColorSpace::DisplayP3 | ExportColorSpace::Rec2020 => {
            let params = [2.4, 1.0 / 1.055, 0.055 / 1.055, 1.0 / 12.92, 0.040_45, 0.0, 0.0];
            ToneCurve::new_parametric(4, &params).unwrap_or_else(|_| ToneCurve::new(2.2))
        }
        ExportColorSpace::AdobeRgb => ToneCurve::new(2.2),
        ExportColorSpace::Prophoto => ToneCurve::new(1.8),
    }
}

pub fn profile_bytes(space: ExportColorSpace) -> Option<Vec<u8>> {
    let white = white_point(space);
    let prims = primaries(space);
    let curve = tone_curve(space);
    let profile = Profile::new_rgb(&white, &prims, &[&curve, &curve, &curve]).ok()?;
    profile.icc().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_valid_icc(space: ExportColorSpace) {
        let bytes = profile_bytes(space);
        assert!(bytes.is_some(), "{space:?} profile missing");
        if let Some(bytes) = bytes {
            assert!(bytes.len() > 128, "{space:?} profile too small: {}", bytes.len());
            assert_eq!(&bytes[36..40], b"acsp", "{space:?} missing acsp signature");
        }
    }

    #[test]
    fn every_space_produces_a_valid_icc_profile() {
        assert_valid_icc(ExportColorSpace::Srgb);
        assert_valid_icc(ExportColorSpace::DisplayP3);
        assert_valid_icc(ExportColorSpace::Rec2020);
        assert_valid_icc(ExportColorSpace::AdobeRgb);
        assert_valid_icc(ExportColorSpace::Prophoto);
    }
}
