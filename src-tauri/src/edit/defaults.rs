use std::collections::HashMap;
use std::path::Path;
use std::sync::LazyLock;

use crate::types::{
    BaseCurveMode, ColorState, CurvePoint, CurvesState, DetailState, EditMeta, EditState, EffectsState, GeometryState, HslAdjust, HslBand, LensState,
    ToneState, WbMode, WbState,
};

pub static DEFAULT_EDIT_STATE: LazyLock<EditState> = LazyLock::new(build_default);

const HSL_BANDS: [HslBand; 8] = [
    HslBand::Red,
    HslBand::Orange,
    HslBand::Yellow,
    HslBand::Green,
    HslBand::Aqua,
    HslBand::Blue,
    HslBand::Purple,
    HslBand::Magenta,
];

fn linear_curve() -> Vec<CurvePoint> {
    vec![CurvePoint { x: 0.0, y: 0.0 }, CurvePoint { x: 1.0, y: 1.0 }]
}

fn default_hsl() -> HashMap<HslBand, HslAdjust> {
    HSL_BANDS.into_iter().map(|band| (band, HslAdjust { hue: 0.0, sat: 0.0, lum: 0.0 })).collect()
}

fn build_default() -> EditState {
    EditState {
        version: 2,
        wb: WbState {
            mode: WbMode::AsShot,
            temp: 6500.0,
            tint: 0.0,
            temp_shift: None,
        },
        lens: LensState {
            auto_profile: true,
            profile_id: None,
            distortion: 100.0,
            tca: 100.0,
            vignette: 100.0,
            manual_vignette: 0.0,
            manual_distortion: 0.0,
        },
        geometry: GeometryState {
            rotate90: 0,
            flip_h: false,
            flip_v: false,
            straighten: 0.0,
            perspective_v: 0.0,
            perspective_h: 0.0,
            perspective_rotate: 0.0,
            aspect_adjust: 0.0,
            scale: 100.0,
            offset_x: 0.0,
            offset_y: 0.0,
        },
        crop: None,
        scan: None,
        drawer: None,
        tone: ToneState {
            exposure: 0.0,
            contrast: 0.0,
            highlights: 0.0,
            shadows: 0.0,
            whites: 0.0,
            blacks: 0.0,
            highlight_recovery: 0.0,
        },
        base_curve: BaseCurveMode::Standard,
        curves: CurvesState {
            rgb: linear_curve(),
            red: linear_curve(),
            green: linear_curve(),
            blue: linear_curve(),
        },
        color: ColorState {
            vibrance: 0.0,
            saturation: 0.0,
            hsl: default_hsl(),
            bw: false,
        },
        detail: DetailState {
            sharpen_amount: 25.0,
            sharpen_radius: 1.0,
            sharpen_detail: 25.0,
            sharpen_masking: 0.0,
            nr_luminance: 0.0,
            nr_luma_detail: 50.0,
            nr_luma_contrast: 0.0,
            nr_color: 25.0,
            nr_color_detail: 50.0,
            hot_pixel_removal: true,
        },
        effects: EffectsState {
            clarity: 0.0,
            dehaze: 0.0,
            vignette_amount: 0.0,
            vignette_midpoint: 50.0,
            vignette_roundness: 0.0,
            vignette_feather: 50.0,
            grain_amount: 0.0,
            grain_size: 0.0,
            grain_roughness: 0.0,
        },
        meta: EditMeta {
            applied_preset: None,
            modified_at: 0.0,
        },
    }
}

pub fn default_edit_state() -> EditState {
    DEFAULT_EDIT_STATE.clone()
}

pub fn is_default(state: &EditState) -> bool {
    let base = &*DEFAULT_EDIT_STATE;
    state.version == base.version
        && state.wb == base.wb
        && state.lens == base.lens
        && state.geometry == base.geometry
        && state.crop == base.crop
        && state.scan == base.scan
        && state.drawer == base.drawer
        && state.tone == base.tone
        && state.base_curve == base.base_curve
        && state.curves == base.curves
        && state.color == base.color
        && state.detail == base.detail
        && state.effects == base.effects
}

pub fn iso_auto_nr_luminance(iso: f32) -> f64 {
    let iso = iso as f64;
    if !iso.is_finite() || iso <= 400.0 {
        return 0.0;
    }
    if iso <= 1600.0 {
        return lerp(0.0, 15.0, (iso - 400.0) / (1600.0 - 400.0));
    }
    if iso <= 6400.0 {
        return lerp(15.0, 35.0, (iso - 1600.0) / (6400.0 - 1600.0));
    }
    (35.0 + (iso / 6400.0).log2() * 8.0).min(60.0)
}

fn lerp(from: f64, to: f64, t: f64) -> f64 {
    from + (to - from) * t
}

#[cfg_attr(not(feature = "libraw"), allow(unused_variables))]
pub fn initial_edit_state(path: &Path, is_raw: bool) -> EditState {
    let mut state = default_edit_state();
    if is_raw {
        #[cfg(feature = "libraw")]
        if let Some(iso) = crate::decode::probe_iso(path) {
            state.detail.nr_luminance = iso_auto_nr_luminance(iso);
        }
    } else {
        state.detail.sharpen_amount = 0.0;
    }
    state
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_edit_state_snapshot_matches_docs_file() -> Result<(), Box<dyn std::error::Error>> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../docs/phase2-default-editstate.json");
        let expected = serde_json::to_value(default_edit_state())?;
        if std::env::var_os("UPDATE_EDITSTATE_SNAPSHOT").is_some() || !path.exists() {
            std::fs::write(&path, format!("{}\n", serde_json::to_string_pretty(&expected)?))?;
        }
        let on_disk = std::fs::read_to_string(&path)?;
        let actual: serde_json::Value = serde_json::from_str(&on_disk)?;
        assert_eq!(actual, expected);
        Ok(())
    }

    #[test]
    fn is_default_true_for_default_and_ignores_meta() {
        let mut state = default_edit_state();
        assert!(is_default(&state));
        state.meta.modified_at = 12345.0;
        state.meta.applied_preset = Some("preset".to_owned());
        assert!(is_default(&state));
        state.tone.exposure = 0.5;
        assert!(!is_default(&state));
    }

    #[test]
    fn is_default_false_when_scan_present() {
        let mut state = default_edit_state();
        state.scan = Some(crate::types::ScanState {
            enabled: true,
            corners: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]],
            edges: [[0.5, 0.1], [0.9, 0.5], [0.5, 0.9], [0.1, 0.5]],
        });
        assert!(!is_default(&state));
    }

    #[test]
    fn edit_state_without_scan_field_deserializes_to_none() -> Result<(), Box<dyn std::error::Error>> {
        let mut value = serde_json::to_value(default_edit_state())?;
        value.as_object_mut().and_then(|map| map.remove("scan"));
        let state: EditState = serde_json::from_value(value)?;
        assert!(state.scan.is_none());
        assert!(is_default(&state));
        Ok(())
    }

    #[test]
    fn edit_state_without_drawer_field_deserializes_to_none() -> Result<(), Box<dyn std::error::Error>> {
        let mut value = serde_json::to_value(default_edit_state())?;
        value.as_object_mut().and_then(|map| map.remove("drawer"));
        let state: EditState = serde_json::from_value(value)?;
        assert!(state.drawer.is_none());
        assert!(is_default(&state));
        Ok(())
    }

    #[test]
    fn drawer_objects_round_trip_through_json() -> Result<(), Box<dyn std::error::Error>> {
        use crate::types::{DrawerAdjust, DrawerBlendMode, DrawerLayer, DrawerObject, DrawerShapeKind, DrawerState, DrawerTool, DrawerTransform};
        let mut state = default_edit_state();
        state.drawer = Some(DrawerState {
            layers: vec![DrawerLayer {
                id: "layer-1".to_owned(),
                name: "Layer 1".to_owned(),
                visible: true,
                opacity: 80.0,
                objects: vec![
                    DrawerObject::Stroke {
                        tool: DrawerTool::Brush,
                        color: "#ff0000".to_owned(),
                        size: 2.5,
                        opacity: 100.0,
                        points: vec![[0.1, 0.1], [0.2, 0.15]],
                        clip: Some(vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]),
                    },
                    DrawerObject::Shape {
                        shape: DrawerShapeKind::Arrow,
                        color: "#00ff00".to_owned(),
                        size: 1.0,
                        fill: false,
                        from: [0.3, 0.3],
                        to: [0.6, 0.5],
                        clip: None,
                    },
                    DrawerObject::Text {
                        text: "메모".to_owned(),
                        color: "#ffffff".to_owned(),
                        size: 4.0,
                        position: [0.5, 0.5],
                    },
                    DrawerObject::Fill {
                        color: "#0000ff".to_owned(),
                        seed: [0.4, 0.4],
                        clip: None,
                    },
                    DrawerObject::Clone {
                        points: vec![[0.5, 0.5], [0.55, 0.5]],
                        offset: [0.1, -0.05],
                        size: 3.0,
                        clip: None,
                    },
                    DrawerObject::Blur {
                        points: vec![[0.7, 0.7]],
                        size: 5.0,
                        clip: None,
                    },
                ],
                blend: DrawerBlendMode::Multiply,
                transform: Some(DrawerTransform {
                    offset_x: 0.05,
                    offset_y: -0.02,
                    scale: 120.0,
                    rotate: 15.0,
                }),
                adjust: Some(DrawerAdjust {
                    brightness: 10.0,
                    contrast: -5.0,
                    saturation: 20.0,
                    hue: 30.0,
                }),
            }],
        });
        assert!(!is_default(&state));
        let json = serde_json::to_string(&state)?;
        assert!(json.contains("\"kind\":\"stroke\""));
        assert!(json.contains("\"kind\":\"clone\""));
        let parsed: EditState = serde_json::from_str(&json)?;
        assert_eq!(parsed.drawer, state.drawer);
        Ok(())
    }

    #[test]
    fn drawer_layer_without_d2_fields_gets_defaults() -> Result<(), Box<dyn std::error::Error>> {
        use crate::types::{DrawerBlendMode, DrawerLayer};
        let json = r##"{"id":"layer-1","name":"Layer 1","visible":true,"opacity":100.0,"objects":[
            {"kind":"stroke","tool":"brush","color":"#ff0000","size":2.0,"opacity":100.0,"points":[[0.1,0.1]]}
        ]}"##;
        let layer: DrawerLayer = serde_json::from_str(json)?;
        assert_eq!(layer.blend, DrawerBlendMode::Normal);
        assert!(layer.transform.is_none());
        assert!(layer.adjust.is_none());
        assert!(matches!(&layer.objects[0], crate::types::DrawerObject::Stroke { clip: None, .. }));
        Ok(())
    }

    #[test]
    fn iso_auto_nr_follows_fr7_2_formula() {
        assert_eq!(iso_auto_nr_luminance(100.0), 0.0);
        assert_eq!(iso_auto_nr_luminance(400.0), 0.0);
        assert!((iso_auto_nr_luminance(1000.0) - 7.5).abs() < 1e-6);
        assert!((iso_auto_nr_luminance(1600.0) - 15.0).abs() < 1e-6);
        assert!((iso_auto_nr_luminance(4000.0) - 25.0).abs() < 1e-6);
        assert!((iso_auto_nr_luminance(6400.0) - 35.0).abs() < 1e-6);
        assert!((iso_auto_nr_luminance(12800.0) - 43.0).abs() < 1e-6);
        assert_eq!(iso_auto_nr_luminance(2_000_000.0), 60.0);
        assert_eq!(iso_auto_nr_luminance(0.0), 0.0);
        assert_eq!(iso_auto_nr_luminance(f32::NAN), 0.0);
    }

    #[test]
    fn initial_non_raw_zeroes_sharpen_and_keeps_nr_zero() {
        let state = initial_edit_state(Path::new("/x/y.jpg"), false);
        assert_eq!(state.detail.sharpen_amount, 0.0);
        assert_eq!(state.detail.nr_luminance, 0.0);
    }

    #[test]
    fn initial_raw_keeps_default_sharpen_when_iso_unavailable() {
        let state = initial_edit_state(Path::new("/does/not/exist.cr2"), true);
        assert_eq!(state.detail.sharpen_amount, 25.0);
        assert_eq!(state.detail.nr_luminance, 0.0);
    }
}
