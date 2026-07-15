use crate::edit::default_edit_state;
use crate::types::{CurvePoint, EditState};

pub struct BundledPreset {
    pub name: &'static str,
    pub folder: &'static str,
    pub mask: &'static [&'static str],
    pub state: EditState,
}

fn mask(list: &[&str]) -> Vec<String> {
    list.iter().map(|value| (*value).to_owned()).collect()
}

pub fn bundled_masks() -> Vec<(&'static str, Vec<String>)> {
    bundled_presets().into_iter().map(|preset| (preset.name, mask(preset.mask))).collect()
}

pub fn bundled_presets() -> Vec<BundledPreset> {
    vec![
        neutral(),
        punchy(),
        portrait_soft(),
        landscape_vivid(),
        bw_classic(),
        bw_high_contrast(),
        warm_film(),
        cool_cinematic(),
        faded_matte(),
        hdr_natural(),
    ]
}

fn neutral() -> BundledPreset {
    let state = default_edit_state();
    BundledPreset {
        name: "Neutral",
        folder: "",
        mask: &["tone", "curves", "color"],
        state,
    }
}

fn punchy() -> BundledPreset {
    let mut state = default_edit_state();
    state.tone.contrast = 25.0;
    state.color.vibrance = 20.0;
    state.effects.clarity = 10.0;
    BundledPreset {
        name: "Punchy",
        folder: "",
        mask: &["tone", "color", "effects"],
        state,
    }
}

fn portrait_soft() -> BundledPreset {
    let mut state = default_edit_state();
    state.tone.contrast = -8.0;
    state.tone.highlights = -15.0;
    state.tone.shadows = 12.0;
    state.color.vibrance = 8.0;
    state.color.saturation = -4.0;
    state.detail.sharpen_amount = 12.0;
    state.detail.sharpen_masking = 40.0;
    state.detail.nr_color = 30.0;
    state.effects.clarity = -8.0;
    BundledPreset {
        name: "Portrait Soft",
        folder: "Portrait",
        mask: &["tone", "color", "detail", "effects"],
        state,
    }
}

fn landscape_vivid() -> BundledPreset {
    let mut state = default_edit_state();
    state.tone.contrast = 15.0;
    state.tone.highlights = -20.0;
    state.tone.shadows = 15.0;
    state.tone.whites = 8.0;
    state.tone.blacks = -5.0;
    state.color.vibrance = 30.0;
    state.color.saturation = 10.0;
    state.effects.clarity = 15.0;
    state.effects.dehaze = 12.0;
    BundledPreset {
        name: "Landscape Vivid",
        folder: "Landscape",
        mask: &["tone", "color", "effects"],
        state,
    }
}

fn bw_classic() -> BundledPreset {
    let mut state = default_edit_state();
    state.color.bw = true;
    state.tone.contrast = 15.0;
    BundledPreset {
        name: "B&W Classic",
        folder: "B&W",
        mask: &["color", "tone"],
        state,
    }
}

fn bw_high_contrast() -> BundledPreset {
    let mut state = default_edit_state();
    state.color.bw = true;
    state.tone.contrast = 45.0;
    state.tone.highlights = -10.0;
    state.tone.shadows = -10.0;
    state.tone.whites = 15.0;
    state.tone.blacks = -20.0;
    state.effects.clarity = 20.0;
    BundledPreset {
        name: "B&W High Contrast",
        folder: "B&W",
        mask: &["color", "tone", "effects"],
        state,
    }
}

fn warm_film() -> BundledPreset {
    let mut state = default_edit_state();
    state.wb.temp = 7500.0;
    state.wb.tint = 5.0;
    state.tone.contrast = 8.0;
    state.tone.highlights = -12.0;
    state.tone.blacks = 10.0;
    state.color.vibrance = 10.0;
    state.color.saturation = -5.0;
    state.effects.vignette_amount = -15.0;
    state.effects.grain_amount = 15.0;
    state.effects.grain_size = 25.0;
    BundledPreset {
        name: "Warm Film",
        folder: "Film",
        mask: &["wb", "tone", "color", "effects"],
        state,
    }
}

fn cool_cinematic() -> BundledPreset {
    let mut state = default_edit_state();
    state.wb.temp = 5000.0;
    state.wb.tint = 8.0;
    state.tone.contrast = 18.0;
    state.tone.highlights = -20.0;
    state.tone.shadows = 12.0;
    state.tone.blacks = 8.0;
    state.color.vibrance = 5.0;
    state.color.saturation = -8.0;
    state.effects.vignette_amount = -20.0;
    BundledPreset {
        name: "Cool Cinematic",
        folder: "Film",
        mask: &["wb", "tone", "color", "effects"],
        state,
    }
}

fn faded_matte() -> BundledPreset {
    let mut state = default_edit_state();
    state.tone.contrast = -15.0;
    state.tone.highlights = -10.0;
    state.tone.blacks = 20.0;
    state.color.vibrance = -5.0;
    state.color.saturation = -15.0;
    state.curves.rgb = vec![
        CurvePoint { x: 0.0, y: 0.08 },
        CurvePoint { x: 0.5, y: 0.5 },
        CurvePoint { x: 1.0, y: 0.92 },
    ];
    BundledPreset {
        name: "Faded Matte",
        folder: "",
        mask: &["tone", "color", "curves"],
        state,
    }
}

fn hdr_natural() -> BundledPreset {
    let mut state = default_edit_state();
    state.tone.contrast = 5.0;
    state.tone.highlights = -40.0;
    state.tone.shadows = 40.0;
    state.tone.whites = 10.0;
    state.tone.blacks = -10.0;
    state.tone.highlight_recovery = 30.0;
    state.effects.clarity = 12.0;
    state.effects.dehaze = 8.0;
    BundledPreset {
        name: "HDR Natural",
        folder: "",
        mask: &["tone", "effects"],
        state,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preset::mask::masked_from_default;

    #[test]
    fn ten_bundled_presets_with_expected_names() {
        let presets = bundled_presets();
        assert_eq!(presets.len(), 10);
        let names: Vec<&str> = presets.iter().map(|preset| preset.name).collect();
        assert_eq!(
            names,
            vec![
                "Neutral",
                "Punchy",
                "Portrait Soft",
                "Landscape Vivid",
                "B&W Classic",
                "B&W High Contrast",
                "Warm Film",
                "Cool Cinematic",
                "Faded Matte",
                "HDR Natural",
            ]
        );
    }

    fn find_bundled(name: &str) -> BundledPreset {
        match bundled_presets().into_iter().find(|preset| preset.name == name) {
            Some(preset) => preset,
            None => panic!("bundled preset missing: {name}"),
        }
    }

    #[test]
    fn punchy_matches_contract_values() {
        let punchy = find_bundled("Punchy");
        assert_eq!(punchy.state.tone.contrast, 25.0);
        assert_eq!(punchy.state.color.vibrance, 20.0);
        assert_eq!(punchy.state.effects.clarity, 10.0);
    }

    #[test]
    fn bw_classic_is_monochrome_with_contrast() {
        let bw = find_bundled("B&W Classic");
        assert!(bw.state.color.bw);
        assert_eq!(bw.state.tone.contrast, 15.0);
    }

    #[test]
    fn warm_film_is_warm_with_lifted_blacks() {
        let film = find_bundled("Warm Film");
        assert_eq!(film.state.wb.temp, 7500.0);
        assert_eq!(film.state.tone.blacks, 10.0);
    }

    #[test]
    fn every_bundled_state_leaves_unmasked_sections_default() {
        let default = default_edit_state();
        for preset in bundled_presets() {
            let mask = mask(preset.mask);
            let normalized = masked_from_default(&preset.state, &mask);
            assert_eq!(normalized, preset.state, "preset {} mutates a section outside its mask", preset.name);
            if !mask.iter().any(|section| section == "wb") {
                assert_eq!(preset.state.wb, default.wb, "preset {} wb should be default", preset.name);
            }
            if !mask.iter().any(|section| section == "detail") {
                assert_eq!(preset.state.detail, default.detail, "preset {} detail should be default", preset.name);
            }
        }
    }
}
