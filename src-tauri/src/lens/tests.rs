use crate::lens::db::LensIndex;
use crate::lens::matching::{self, lens_key, LensQuery};
use crate::types_lens::{DistortionModel, TcaModel};

const FIXTURE: &str = r#"<?xml version="1.0"?>
<!DOCTYPE lensdatabase SYSTEM "lensfun-database.dtd">
<lensdatabase version="2">
    <mount>
        <name>Canon EF</name>
        <compat>M42</compat>
    </mount>
    <mount>
        <name>Canon EF-S</name>
        <compat>Canon EF</compat>
    </mount>
    <camera>
        <maker>Canon</maker>
        <model>Canon EOS 5D Mark III</model>
        <model lang="en">EOS 5D Mark III</model>
        <mount>Canon EF</mount>
        <cropfactor>1</cropfactor>
    </camera>
    <camera>
        <maker>Canon</maker>
        <model>Canon EOS 7D</model>
        <mount>Canon EF-S</mount>
        <cropfactor>1.6</cropfactor>
    </camera>
    <lens>
        <maker>Canon</maker>
        <model>Canon EF 16-35mm f/2.8L USM</model>
        <mount>Canon EF</mount>
        <focal min="16" max="35"/>
        <aperture min="2.8" max="22"/>
        <cropfactor>1</cropfactor>
        <calibration>
            <distortion model="ptlens" focal="16" a="0.01687424" b="-0.03208409" c="-0.028794159"/>
            <distortion model="ptlens" focal="35" a="0.0070163863" b="-0.010468312" c="0.0030782963"/>
            <tca model="poly3" focal="16" br="-0.0002000" vr="1.0013882" bb="0.0001579" vb="0.9998360"/>
            <tca model="poly3" focal="35" br="0.0001437" vr="1.0002374" bb="-0.0001347" vb="1.0002667"/>
            <vignetting model="pa" focal="16" aperture="2.8" distance="1000" k1="-0.3176" k2="-0.9708" k3="0.4369"/>
            <vignetting model="pa" focal="35" aperture="2.8" distance="1000" k1="-0.5000" k2="-0.4000" k3="0.2000"/>
        </calibration>
    </lens>
    <lens>
        <maker>Canon</maker>
        <model>Canon EF 50mm f/1.8 STM</model>
        <mount>Canon EF</mount>
        <focal value="50"/>
        <aperture min="1.8" max="22"/>
        <cropfactor>1</cropfactor>
        <calibration>
            <distortion model="poly3" focal="50" k1="-0.008"/>
        </calibration>
    </lens>
    <lens>
        <maker>Canon</maker>
        <model>Canon EF-S 17-55mm f/2.8 IS USM</model>
        <mount>Canon EF-S</mount>
        <focal min="17" max="55"/>
        <aperture min="2.8" max="22"/>
        <cropfactor>1.6</cropfactor>
        <calibration>
            <distortion model="ptlens" focal="17" a="0.001" b="-0.01" c="0.002"/>
        </calibration>
    </lens>
    <lens>
        <maker>Canon</maker>
        <model>Canon EF Gatetest 100mm f/2</model>
        <mount>Canon EF</mount>
        <focal value="100"/>
        <aperture min="2" max="22"/>
        <cropfactor>2</cropfactor>
        <calibration>
            <distortion model="poly3" focal="100" k1="-0.01"/>
        </calibration>
    </lens>
</lensdatabase>
"#;

fn index() -> LensIndex {
    LensIndex::from_str(FIXTURE)
}

fn zoom_query() -> LensQuery {
    LensQuery {
        camera_make: Some("Canon".to_owned()),
        camera_model: Some("Canon EOS 5D Mark III".to_owned()),
        lens_make: Some("Canon".to_owned()),
        lens_model: Some("Canon EF 16-35mm f/2.8L USM".to_owned()),
        focal: Some(24.0),
        aperture: Some(2.8),
        distance: None,
    }
}

#[test]
fn parses_cameras_lenses_and_mounts() {
    let index = index();
    assert_eq!(index.cameras.len(), 2);
    assert_eq!(index.lenses.len(), 4);
    assert!(index.mounts.contains_key("Canon EF"));
    assert!(index.mounts.contains_key("Canon EF-S"));
    let ef_s = index.mounts.get("Canon EF-S").cloned().unwrap_or_default();
    assert!(ef_s.iter().any(|value| value == "Canon EF"));
    let five_d = index.cameras.iter().find(|camera| camera.model == "Canon EOS 5D Mark III");
    assert!(matches!(five_d, Some(camera) if camera.aliases.iter().any(|alias| alias == "EOS 5D Mark III")));
}

#[test]
fn parses_calibration_terms_in_lensfun_order() {
    let index = index();
    let zoom = index.lenses.iter().find(|lens| lens.model.contains("16-35")).cloned().unwrap_or_else(|| panic!("zoom lens missing"));
    assert_eq!(zoom.calibration.distortion.len(), 2);
    assert_eq!(zoom.calibration.tca.len(), 2);
    assert_eq!(zoom.calibration.vignetting.len(), 2);

    let dist16 = zoom.calibration.distortion.iter().find(|entry| entry.focal == 16.0).unwrap_or_else(|| panic!("no focal-16 distortion"));
    assert_eq!(dist16.model, DistortionModel::Ptlens);
    assert_eq!(dist16.terms, vec![0.01687424, -0.03208409, -0.028794159]);

    let tca16 = zoom.calibration.tca.iter().find(|entry| entry.focal == 16.0).unwrap_or_else(|| panic!("no focal-16 tca"));
    assert_eq!(tca16.model, TcaModel::Poly3);
    assert_eq!(tca16.terms, vec![1.0013882, 0.9998360, 0.0, 0.0, -0.0002000, 0.0001579]);

    let vig16 = zoom.calibration.vignetting.iter().find(|entry| entry.focal == 16.0).unwrap_or_else(|| panic!("no focal-16 vignetting"));
    assert_eq!(vig16.aperture, 2.8);
    assert_eq!(vig16.distance, 1000.0);
    assert_eq!(vig16.terms, [-0.3176, -0.9708, 0.4369]);
}

#[test]
fn matches_5d3_with_standard_zoom() {
    let index = index();
    let matched = matching::find_profile(&index, &zoom_query(), None).unwrap_or_else(|| panic!("expected a profile match"));
    assert_eq!(matched.lens_name, "Canon EF 16-35mm f/2.8L USM");
    assert_eq!(matched.distortion.model, DistortionModel::Ptlens);
    assert_eq!(matched.distortion.coeffs.len(), 3);
    assert_eq!(matched.tca.model, TcaModel::Poly3);
    assert_eq!(matched.tca.coeffs.len(), 6);
    assert!(matched.vignetting.is_some());
    assert!(!matched.profile_id.is_empty());
}

#[test]
fn interpolates_distortion_linearly_in_focal() {
    let index = index();
    let matched = matching::find_profile(&index, &zoom_query(), None).unwrap_or_else(|| panic!("expected match"));

    let t = (24.0 - 16.0) / (35.0 - 16.0);
    let lerp = |low: f64, high: f64| low + (high - low) * t;
    let expected = [
        lerp(0.01687424, 0.0070163863),
        lerp(-0.03208409, -0.010468312),
        lerp(-0.028794159, 0.0030782963),
    ];
    for (index, value) in matched.distortion.coeffs.iter().enumerate() {
        assert!((value - expected[index]).abs() < 1e-9, "distortion term {index}: {value} vs {}", expected[index]);
    }

    let tca_expected = [
        lerp(1.0013882, 1.0002374),
        lerp(0.9998360, 1.0002667),
        0.0,
        0.0,
        lerp(-0.0002000, 0.0001437),
        lerp(0.0001579, -0.0001347),
    ];
    for (index, value) in matched.tca.coeffs.iter().enumerate() {
        assert!((value - tca_expected[index]).abs() < 1e-9, "tca term {index}: {value} vs {}", tca_expected[index]);
    }
}

#[test]
fn exact_calibrated_focal_returns_exact_terms() {
    let index = index();
    let mut query = zoom_query();
    query.focal = Some(16.0);
    let matched = matching::find_profile(&index, &query, None).unwrap_or_else(|| panic!("expected match"));
    assert_eq!(matched.distortion.coeffs, vec![0.01687424, -0.03208409, -0.028794159]);
}

#[test]
fn focal_outside_range_clamps_to_nearest_endpoint() {
    let index = index();
    let mut query = zoom_query();
    query.focal = Some(200.0);
    let matched = matching::find_profile(&index, &query, None).unwrap_or_else(|| panic!("expected match"));
    assert_eq!(matched.distortion.coeffs, vec![0.0070163863, -0.010468312, 0.0030782963]);
}

#[test]
fn full_frame_lens_matches_on_crop_body() {
    let index = index();
    let query = LensQuery {
        camera_make: Some("Canon".to_owned()),
        camera_model: Some("Canon EOS 7D".to_owned()),
        lens_make: Some("Canon".to_owned()),
        lens_model: Some("Canon EF 16-35mm f/2.8L USM".to_owned()),
        focal: Some(24.0),
        aperture: Some(2.8),
        distance: None,
    };
    let matched = matching::find_profile(&index, &query, None);
    assert!(matches!(matched, Some(profile) if profile.lens_name.contains("16-35")));
}

#[test]
fn crop_body_lens_excluded_from_full_frame_body() {
    let index = index();
    let query = LensQuery {
        camera_make: Some("Canon".to_owned()),
        camera_model: Some("Canon EOS 5D Mark III".to_owned()),
        lens_make: Some("Canon".to_owned()),
        lens_model: Some("Canon EF-S 17-55mm f/2.8 IS USM".to_owned()),
        focal: Some(24.0),
        aperture: Some(2.8),
        distance: None,
    };
    assert!(matching::find_profile(&index, &query, None).is_none());
}

#[test]
fn calibration_sensor_larger_than_camera_returns_none() {
    let index = index();
    let query = LensQuery {
        camera_make: Some("Canon".to_owned()),
        camera_model: Some("Canon EOS 5D Mark III".to_owned()),
        lens_make: Some("Canon".to_owned()),
        lens_model: Some("Canon EF Gatetest 100mm f/2".to_owned()),
        focal: Some(100.0),
        aperture: Some(2.0),
        distance: None,
    };
    assert!(matching::find_profile(&index, &query, None).is_none());
}

#[test]
fn manual_override_forces_selected_profile() {
    let index = index();
    let fifty = index.lenses.iter().find(|lens| lens.model.contains("50mm")).cloned().unwrap_or_else(|| panic!("50mm missing"));
    let query = LensQuery {
        camera_make: Some("Canon".to_owned()),
        camera_model: Some("Canon EOS 5D Mark III".to_owned()),
        lens_make: Some("Canon".to_owned()),
        lens_model: Some("Totally Unknown Lens 999".to_owned()),
        focal: Some(50.0),
        aperture: Some(1.8),
        distance: None,
    };
    assert!(matching::find_profile(&index, &query, None).is_none());
    let matched = matching::find_profile(&index, &query, Some(&fifty.profile_id)).unwrap_or_else(|| panic!("override match"));
    assert_eq!(matched.lens_name, "Canon EF 50mm f/1.8 STM");
    assert_eq!(matched.distortion.model, DistortionModel::Poly3);
}

#[test]
fn search_profiles_filters_by_query() {
    let index = index();
    let results = matching::search_profiles(&index, "16-35", 10);
    assert!(results.iter().any(|(_, name)| name.contains("16-35mm")));
    let fifty = matching::search_profiles(&index, "50mm", 10);
    assert!(matches!(fifty.first(), Some((_, name)) if name.contains("50mm")));
    let all = matching::search_profiles(&index, "", 10);
    assert_eq!(all.len(), 4);
}

#[test]
fn lens_key_is_stable_and_lowercased() {
    assert_eq!(
        lens_key(Some("Canon"), Some("EF 16-35mm f/2.8L USM")),
        Some("canon|ef 16-35mm f/2.8l usm".to_owned())
    );
    assert_eq!(lens_key(None, Some("Sigma 35mm")), Some("|sigma 35mm".to_owned()));
    assert_eq!(lens_key(Some("Canon"), None), None);
}

#[test]
fn bundled_database_parses_with_expected_coverage() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/lensfun");
    let index = LensIndex::load_dir(&dir);
    if !index.loaded || index.lenses.is_empty() {
        eprintln!("skipping: bundled lensfun db not present (run scripts/sync-lensfun.sh)");
        return;
    }
    eprintln!("lensfun coverage: {} cameras, {} lenses, {} mounts", index.cameras.len(), index.lenses.len(), index.mounts.len());
    assert!(index.cameras.len() > 600, "camera coverage too low: {}", index.cameras.len());
    assert!(index.lenses.len() > 800, "lens coverage too low: {}", index.lenses.len());
    let calibrated = index.lenses.iter().filter(|lens| !lens.calibration.is_empty()).count();
    assert!(calibrated > 700, "calibrated lens coverage too low: {calibrated}");

    let query = zoom_query();
    let matched = matching::find_profile(&index, &query, None).unwrap_or_else(|| panic!("expected real-db match for 5D3 + EF 16-35"));
    assert_eq!(matched.distortion.model, DistortionModel::Ptlens);
    assert!(matched.vignetting.is_some());
}

#[test]
fn vignetting_absent_when_aperture_unknown() {
    let index = index();
    let mut query = zoom_query();
    query.aperture = None;
    let matched = matching::find_profile(&index, &query, None).unwrap_or_else(|| panic!("expected match"));
    assert!(matched.vignetting.is_none());
}
