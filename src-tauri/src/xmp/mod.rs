use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;

use crate::edit::default_edit_state;
use crate::error::{AppError, AppResult};
use crate::types::{EditState, WbMode};
use crate::types_meta::Flag;

const AETHER_STATE_ATTR: &str = "aether:state";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OrganizeFields {
    pub rating: u8,
    pub flag: Option<Flag>,
    pub label: Option<String>,
}

impl OrganizeFields {
    pub fn is_empty(&self) -> bool {
        self.rating == 0 && self.flag.is_none() && self.label.is_none()
    }
}

pub fn sidecar_path(image_path: &Path) -> PathBuf {
    image_path.with_extension("xmp")
}

pub fn sidecar_mtime_ns(image_path: &Path) -> Option<i64> {
    let meta = std::fs::metadata(sidecar_path(image_path)).ok()?;
    let mtime = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    Some(mtime.as_nanos() as i64)
}

pub fn write_sidecar(image_path: &Path, state: &EditState) -> AppResult<()> {
    let organize = read_organize(image_path).unwrap_or_default();
    write_sidecar_full(image_path, state, &organize)
}

pub fn write_sidecar_full(image_path: &Path, state: &EditState, organize: &OrganizeFields) -> AppResult<()> {
    let target = sidecar_path(image_path);
    if target == image_path {
        return Err(AppError::Internal("refusing to write sidecar onto the original file".to_owned()));
    }
    let xml = to_xmp_string(image_path, state, organize)?;
    std::fs::write(&target, xml)?;
    Ok(())
}

pub fn read_sidecar(image_path: &Path) -> AppResult<EditState> {
    let xml = std::fs::read_to_string(sidecar_path(image_path))?;
    from_xmp_string(&xml)
}

pub fn read_organize(image_path: &Path) -> AppResult<OrganizeFields> {
    let xml = std::fs::read_to_string(sidecar_path(image_path))?;
    Ok(read_organize_from_str(&xml))
}

pub fn read_organize_from_str(xml: &str) -> OrganizeFields {
    let rating = find_attr(xml, "xmp:Rating").and_then(|value| value.trim().parse::<u8>().ok()).unwrap_or(0);
    let crs_rating = find_attr_f64(xml, "crs:Rating");
    let flag = find_attr(xml, "aether:Flag")
        .and_then(|value| Flag::parse(value.trim()))
        .or_else(|| if crs_rating == Some(-1.0) { Some(Flag::Reject) } else { None });
    let label = find_attr(xml, "xmp:Label").map(|value| value.trim().to_owned()).filter(|value| !value.is_empty());
    OrganizeFields { rating, flag, label }
}

pub fn encode_state(state: &EditState) -> AppResult<String> {
    let json = serde_json::to_vec(state).map_err(|error| AppError::Internal(error.to_string()))?;
    let compressed = zstd::encode_all(json.as_slice(), 19).map_err(|error| AppError::Io(error.to_string()))?;
    Ok(STANDARD.encode(compressed))
}

pub fn decode_state(encoded: &str) -> AppResult<EditState> {
    let compressed = STANDARD.decode(encoded.trim()).map_err(|error| AppError::Internal(format!("aether:state base64: {error}")))?;
    let json = zstd::decode_all(compressed.as_slice()).map_err(|error| AppError::Io(format!("aether:state zstd: {error}")))?;
    serde_json::from_slice(&json).map_err(|error| AppError::Internal(format!("aether:state json: {error}")))
}

pub fn to_xmp_string(image_path: &Path, state: &EditState, organize: &OrganizeFields) -> AppResult<String> {
    let encoded = encode_state(state)?;
    let raw_file_name = image_path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
    let crs = crs_attributes(state);
    let organize_lines = organize_attributes(organize);
    Ok(format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="AetherLens">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:aether="http://ns.aetherlens.app/1.0/"
    crs:Version="15.0"
    crs:ProcessVersion="11.0"
    crs:HasSettings="True"
    crs:RawFileName="{raw}"
{crs}{organize}    aether:version="2"
    aether:engine="rec2020-linear"
    aether:state="{encoded}">
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
"#,
        raw = xml_escape(raw_file_name),
        crs = crs,
        organize = organize_lines,
        encoded = encoded,
    ))
}

pub fn to_preset_xmp_string(state: &EditState) -> AppResult<String> {
    let encoded = encode_state(state)?;
    let crs = crs_attributes(state);
    Ok(format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="AetherLens">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:aether="http://ns.aetherlens.app/1.0/"
    crs:Version="15.0"
    crs:ProcessVersion="11.0"
    crs:HasSettings="True"
{crs}    aether:version="2"
    aether:engine="rec2020-linear"
    aether:state="{encoded}">
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
"#,
        crs = crs,
        encoded = encoded,
    ))
}

fn organize_attributes(organize: &OrganizeFields) -> String {
    let mut lines = String::new();
    if organize.rating > 0 {
        lines.push_str(&format!("    xmp:Rating=\"{}\"\n", organize.rating.min(5)));
    }
    if let Some(label) = &organize.label {
        lines.push_str(&format!("    xmp:Label=\"{}\"\n", xml_escape(label)));
    }
    if let Some(flag) = organize.flag {
        lines.push_str(&format!("    aether:Flag=\"{}\"\n", flag.as_str()));
        if flag == Flag::Reject {
            lines.push_str("    crs:Rating=\"-1\"\n");
        }
    }
    lines
}

pub fn from_xmp_string(xml: &str) -> AppResult<EditState> {
    if let Some(encoded) = find_attr(xml, AETHER_STATE_ATTR) {
        return decode_state(&encoded);
    }
    Ok(import_crs(xml))
}

fn crs_attributes(state: &EditState) -> String {
    let mut lines = String::new();
    let mut push = |name: &str, value: String| {
        lines.push_str(&format!("    crs:{name}=\"{value}\"\n"));
    };
    push("Temperature", num(state.wb.temp));
    push("Tint", num(state.wb.tint));
    push("Exposure2012", num(state.tone.exposure));
    push("Contrast2012", num(state.tone.contrast));
    push("Highlights2012", num(state.tone.highlights));
    push("Shadows2012", num(state.tone.shadows));
    push("Whites2012", num(state.tone.whites));
    push("Blacks2012", num(state.tone.blacks));
    push("Clarity2012", num(state.effects.clarity));
    push("Dehaze", num(state.effects.dehaze));
    push("Vibrance", num(state.color.vibrance));
    push("Saturation", num(state.color.saturation));
    push("Sharpness", num(state.detail.sharpen_amount.clamp(0.0, 150.0)));
    push("SharpenRadius", num(state.detail.sharpen_radius));
    push("SharpenDetail", num(state.detail.sharpen_detail));
    push("SharpenEdgeMasking", num(state.detail.sharpen_masking));
    push("LuminanceSmoothing", num(state.detail.nr_luminance));
    push("ColorNoiseReduction", num(state.detail.nr_color));
    push("ConvertToGrayscale", if state.color.bw { "True".to_owned() } else { "False".to_owned() });
    lines
}

fn import_crs(xml: &str) -> EditState {
    let mut state = default_edit_state();
    if let Some(value) = find_attr_f64(xml, "crs:Temperature") {
        state.wb.temp = value;
        state.wb.mode = WbMode::Custom;
    }
    if let Some(value) = find_attr_f64(xml, "crs:Tint") {
        state.wb.tint = value;
    }
    if let Some(value) = find_attr_f64(xml, "crs:Exposure2012") {
        state.tone.exposure = value;
    }
    if let Some(value) = find_attr_f64(xml, "crs:Contrast2012") {
        state.tone.contrast = value;
    }
    if let Some(value) = find_attr_f64(xml, "crs:Highlights2012") {
        state.tone.highlights = value;
    }
    if let Some(value) = find_attr_f64(xml, "crs:Shadows2012") {
        state.tone.shadows = value;
    }
    if let Some(value) = find_attr_f64(xml, "crs:Whites2012") {
        state.tone.whites = value;
    }
    if let Some(value) = find_attr_f64(xml, "crs:Blacks2012") {
        state.tone.blacks = value;
    }
    if let Some(value) = find_attr_f64(xml, "crs:Clarity2012") {
        state.effects.clarity = value;
    }
    if let Some(value) = find_attr_f64(xml, "crs:Dehaze") {
        state.effects.dehaze = value;
    }
    if let Some(value) = find_attr_f64(xml, "crs:Vibrance") {
        state.color.vibrance = value;
    }
    if let Some(value) = find_attr_f64(xml, "crs:Saturation") {
        state.color.saturation = value;
    }
    if let Some(value) = find_attr_f64(xml, "crs:Sharpness") {
        state.detail.sharpen_amount = value;
    }
    if let Some(value) = find_attr_f64(xml, "crs:SharpenRadius") {
        state.detail.sharpen_radius = value;
    }
    if let Some(value) = find_attr_f64(xml, "crs:SharpenDetail") {
        state.detail.sharpen_detail = value;
    }
    if let Some(value) = find_attr_f64(xml, "crs:SharpenEdgeMasking") {
        state.detail.sharpen_masking = value;
    }
    if let Some(value) = find_attr_f64(xml, "crs:LuminanceSmoothing") {
        state.detail.nr_luminance = value;
    }
    if let Some(value) = find_attr_f64(xml, "crs:ColorNoiseReduction") {
        state.detail.nr_color = value;
    }
    if let Some(value) = find_attr(xml, "crs:ConvertToGrayscale") {
        state.color.bw = value.eq_ignore_ascii_case("true");
    }
    state
}

fn num(value: f64) -> String {
    format!("{value}")
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn find_attr_f64(xml: &str, key: &str) -> Option<f64> {
    find_attr(xml, key).and_then(|value| value.trim().parse::<f64>().ok())
}

fn find_attr(xml: &str, key: &str) -> Option<String> {
    let bytes = xml.as_bytes();
    let mut search_start = 0;
    while let Some(rel) = xml[search_start..].find(key) {
        let idx = search_start + rel;
        let boundary_ok = idx == 0 || matches!(bytes[idx - 1], b' ' | b'\t' | b'\n' | b'\r' | b'"' | b'\'');
        if boundary_ok {
            let rest = xml[idx + key.len()..].trim_start();
            if let Some(after_eq) = rest.strip_prefix('=') {
                let after_eq = after_eq.trim_start();
                let mut chars = after_eq.char_indices();
                if let Some((_, quote)) = chars.next() {
                    if quote == '"' || quote == '\'' {
                        let inner = &after_eq[quote.len_utf8()..];
                        if let Some(end) = inner.find(quote) {
                            return Some(inner[..end].to_owned());
                        }
                    }
                }
            }
        }
        search_start = idx + key.len();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edit::default_edit_state;

    fn sample_state() -> EditState {
        let mut state = default_edit_state();
        state.wb.mode = WbMode::Custom;
        state.wb.temp = 5200.0;
        state.wb.tint = 8.0;
        state.tone.exposure = 0.4;
        state.tone.contrast = -15.0;
        state.color.vibrance = 12.0;
        state.color.bw = true;
        state.detail.sharpen_amount = 40.0;
        state.detail.nr_luminance = 20.0;
        state.crop = Some(crate::types::CropState {
            enabled: true,
            left: 0.05,
            top: 0.1,
            right: 0.95,
            bottom: 0.9,
            aspect: "16:9".to_owned(),
        });
        if let Some(adjust) = state.color.hsl.get_mut(&crate::types::HslBand::Blue) {
            adjust.hue = -10.0;
            adjust.sat = 22.0;
        }
        state.meta.modified_at = 1_700_000_000_000.0;
        state
    }

    #[test]
    fn round_trip_preserves_full_state() {
        let state = sample_state();
        let xml = match to_xmp_string(Path::new("/photos/IMG_1234.CR2"), &state, &OrganizeFields::default()) {
            Ok(xml) => xml,
            Err(error) => panic!("to_xmp_string failed: {error}"),
        };
        assert!(xml.contains("aether:state=\""));
        assert!(xml.contains("crs:ProcessVersion=\"11.0\""));
        assert!(xml.contains("crs:RawFileName=\"IMG_1234.CR2\""));
        let restored = match from_xmp_string(&xml) {
            Ok(restored) => restored,
            Err(error) => panic!("from_xmp_string failed: {error}"),
        };
        assert_eq!(restored, state);
    }

    #[test]
    fn organize_and_edit_state_coexist_in_one_sidecar() {
        let state = sample_state();
        let organize = OrganizeFields {
            rating: 4,
            flag: Some(Flag::Pick),
            label: Some("Red".to_owned()),
        };
        let xml = match to_xmp_string(Path::new("/photos/IMG_1234.CR2"), &state, &organize) {
            Ok(xml) => xml,
            Err(error) => panic!("to_xmp_string failed: {error}"),
        };
        assert!(xml.contains("xmp:Rating=\"4\""));
        assert!(xml.contains("xmp:Label=\"Red\""));
        assert!(xml.contains("aether:Flag=\"pick\""));
        assert_eq!(from_xmp_string(&xml).ok(), Some(state));
        assert_eq!(read_organize_from_str(&xml), organize);
    }

    #[test]
    fn reject_flag_writes_lightroom_crs_rating() {
        let organize = OrganizeFields {
            rating: 0,
            flag: Some(Flag::Reject),
            label: None,
        };
        let xml = match to_xmp_string(Path::new("/photos/IMG_9.CR2"), &default_edit_state(), &organize) {
            Ok(xml) => xml,
            Err(error) => panic!("to_xmp_string failed: {error}"),
        };
        assert!(xml.contains("aether:Flag=\"reject\""));
        assert!(xml.contains("crs:Rating=\"-1\""));
        assert_eq!(read_organize_from_str(&xml), organize);
    }

    #[test]
    fn edit_write_preserves_existing_organize_fields() -> Result<(), Box<dyn std::error::Error>> {
        let dir = std::env::temp_dir().join(format!("raw-viewer-xmp-org-{}", std::process::id()));
        std::fs::create_dir_all(&dir)?;
        let image = dir.join("IMG_ORG.CR2");
        std::fs::write(&image, b"raw")?;

        let organize = OrganizeFields {
            rating: 5,
            flag: Some(Flag::Pick),
            label: Some("Green".to_owned()),
        };
        write_sidecar_full(&image, &default_edit_state(), &organize)?;

        let mut edited = default_edit_state();
        edited.tone.exposure = 1.5;
        write_sidecar(&image, &edited)?;

        assert_eq!(read_sidecar(&image).ok(), Some(edited));
        assert_eq!(read_organize(&image).ok(), Some(organize));
        std::fs::remove_dir_all(&dir)?;
        Ok(())
    }

    #[test]
    fn crs_only_import_approximates_mapped_fields() {
        let xml = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF>
  <rdf:Description rdf:about=""
    crs:Temperature="5000"
    crs:Tint="+8"
    crs:Exposure2012="+0.40"
    crs:Contrast2012="-15"
    crs:Vibrance="+12"
    crs:Saturation="0"
    crs:Sharpness="40"
    crs:LuminanceSmoothing="20"
    crs:ColorNoiseReduction="30"
    crs:ConvertToGrayscale="True">
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#;
        let state = match from_xmp_string(xml) {
            Ok(state) => state,
            Err(error) => panic!("from_xmp_string failed: {error}"),
        };
        assert_eq!(state.wb.temp, 5000.0);
        assert_eq!(state.wb.mode, WbMode::Custom);
        assert_eq!(state.wb.tint, 8.0);
        assert!((state.tone.exposure - 0.4).abs() < 1e-9);
        assert_eq!(state.tone.contrast, -15.0);
        assert_eq!(state.color.vibrance, 12.0);
        assert!(state.color.bw);
        assert_eq!(state.detail.sharpen_amount, 40.0);
        assert_eq!(state.detail.nr_luminance, 20.0);
        assert_eq!(state.detail.nr_color, 30.0);
        assert_eq!(state.base_curve, default_edit_state().base_curve);
    }

    #[test]
    fn sidecar_path_targets_stem_xmp_not_original() {
        let original = Path::new("/photos/IMG_1.CR2");
        let sidecar = sidecar_path(original);
        assert_eq!(sidecar, PathBuf::from("/photos/IMG_1.xmp"));
        assert_ne!(sidecar, original);
    }

    #[test]
    fn write_sidecar_refuses_to_overwrite_matching_path() {
        let result = write_sidecar(Path::new("/photos/IMG_1.xmp"), &default_edit_state());
        assert!(matches!(result, Err(AppError::Internal(_))));
    }

    #[test]
    fn round_trip_via_files() -> Result<(), Box<dyn std::error::Error>> {
        let dir = std::env::temp_dir().join(format!("raw-viewer-xmp-{}", std::process::id()));
        std::fs::create_dir_all(&dir)?;
        let image = dir.join("IMG_9.CR2");
        std::fs::write(&image, b"raw")?;
        let state = sample_state();
        write_sidecar(&image, &state)?;
        let restored = read_sidecar(&image)?;
        assert_eq!(restored, state);
        let original = std::fs::read(&image)?;
        assert_eq!(original, b"raw");
        std::fs::remove_dir_all(&dir)?;
        Ok(())
    }
}
