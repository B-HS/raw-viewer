use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::error::{AppError, AppResult};
use crate::types::EditState;
use crate::types_meta::{ImageMetadata, MetadataWarning};

const TAG_IMAGE_WIDTH: u16 = 256;
const TAG_IMAGE_LENGTH: u16 = 257;
const TAG_XMP: u16 = 700;
const TIFF_TYPE_BYTE: u16 = 1;
const TIFF_TYPE_SHORT: u16 = 3;
const TIFF_TYPE_LONG: u16 = 4;
const ENTRY_LEN: usize = 12;

#[derive(Debug, Clone)]
pub struct DngXmpOutcome {
    pub injected: bool,
    pub warning: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Endian {
    Le,
    Be,
}

impl Endian {
    fn read_u16(self, bytes: &[u8]) -> u16 {
        let array = [bytes[0], bytes[1]];
        match self {
            Endian::Le => u16::from_le_bytes(array),
            Endian::Be => u16::from_be_bytes(array),
        }
    }

    fn read_u32(self, bytes: &[u8]) -> u32 {
        let array = [bytes[0], bytes[1], bytes[2], bytes[3]];
        match self {
            Endian::Le => u32::from_le_bytes(array),
            Endian::Be => u32::from_be_bytes(array),
        }
    }

    fn u16_bytes(self, value: u16) -> [u8; 2] {
        match self {
            Endian::Le => value.to_le_bytes(),
            Endian::Be => value.to_be_bytes(),
        }
    }

    fn u32_bytes(self, value: u32) -> [u8; 4] {
        match self {
            Endian::Le => value.to_le_bytes(),
            Endian::Be => value.to_be_bytes(),
        }
    }
}

struct IfdEntry {
    tag: u16,
    field_type: u16,
    count: u32,
    value: [u8; 4],
}

struct Ifd {
    entries: Vec<IfdEntry>,
    next_offset: u32,
}

struct TiffProbe {
    width: Option<u32>,
    height: Option<u32>,
    xmp: Option<Vec<u8>>,
}

fn read_slice(data: &[u8], offset: usize, len: usize) -> AppResult<&[u8]> {
    let end = offset.checked_add(len).ok_or_else(|| AppError::Internal("tiff offset overflow".to_owned()))?;
    data.get(offset..end).ok_or_else(|| AppError::Internal(format!("tiff read out of bounds at {offset}+{len}")))
}

fn parse_header(data: &[u8]) -> AppResult<(Endian, u32)> {
    let head = read_slice(data, 0, 8)?;
    let endian = match &head[0..2] {
        b"II" => Endian::Le,
        b"MM" => Endian::Be,
        _ => return Err(AppError::Internal("not a tiff container (bad byte-order mark)".to_owned())),
    };
    if endian.read_u16(&head[2..4]) != 42 {
        return Err(AppError::Internal("not a classic tiff (magic != 42)".to_owned()));
    }
    Ok((endian, endian.read_u32(&head[4..8])))
}

fn parse_ifd(data: &[u8], endian: Endian, offset: u32) -> AppResult<Ifd> {
    let base = offset as usize;
    let count = endian.read_u16(read_slice(data, base, 2)?) as usize;
    let mut entries = Vec::with_capacity(count);
    for index in 0..count {
        let entry_off = base + 2 + index * ENTRY_LEN;
        let raw = read_slice(data, entry_off, ENTRY_LEN)?;
        entries.push(IfdEntry {
            tag: endian.read_u16(&raw[0..2]),
            field_type: endian.read_u16(&raw[2..4]),
            count: endian.read_u32(&raw[4..8]),
            value: [raw[8], raw[9], raw[10], raw[11]],
        });
    }
    let next_off = base + 2 + count * ENTRY_LEN;
    let next_offset = endian.read_u32(read_slice(data, next_off, 4)?);
    Ok(Ifd { entries, next_offset })
}

fn scalar_u32(endian: Endian, entry: &IfdEntry) -> Option<u32> {
    match entry.field_type {
        TIFF_TYPE_SHORT => Some(endian.read_u16(&entry.value[0..2]) as u32),
        TIFF_TYPE_LONG => Some(endian.read_u32(&entry.value)),
        _ => None,
    }
}

fn probe_tiff(data: &[u8]) -> AppResult<TiffProbe> {
    let (endian, ifd0) = parse_header(data)?;
    let ifd = parse_ifd(data, endian, ifd0)?;
    let mut probe = TiffProbe {
        width: None,
        height: None,
        xmp: None,
    };
    for entry in &ifd.entries {
        match entry.tag {
            TAG_IMAGE_WIDTH => probe.width = scalar_u32(endian, entry),
            TAG_IMAGE_LENGTH => probe.height = scalar_u32(endian, entry),
            TAG_XMP => {
                let len = entry.count as usize;
                let payload = if len <= 4 {
                    entry.value[..len].to_vec()
                } else {
                    let offset = endian.read_u32(&entry.value) as usize;
                    read_slice(data, offset, len)?.to_vec()
                };
                probe.xmp = Some(payload);
            }
            _ => {}
        }
    }
    Ok(probe)
}

fn align_even(buffer: &mut Vec<u8>) {
    if buffer.len() % 2 != 0 {
        buffer.push(0);
    }
}

fn offset_u32(len: usize) -> AppResult<u32> {
    u32::try_from(len).map_err(|_| AppError::Internal("dng exceeds 4GB classic-tiff offset range".to_owned()))
}

fn build_injected(data: &[u8], packet: &[u8]) -> AppResult<Vec<u8>> {
    let (endian, ifd0) = parse_header(data)?;
    let ifd = parse_ifd(data, endian, ifd0)?;

    let mut out = data.to_vec();
    align_even(&mut out);
    let xmp_offset = offset_u32(out.len())?;
    out.extend_from_slice(packet);
    align_even(&mut out);
    let new_ifd_offset = offset_u32(out.len())?;

    let xmp_entry = IfdEntry {
        tag: TAG_XMP,
        field_type: TIFF_TYPE_BYTE,
        count: offset_u32(packet.len())?,
        value: endian.u32_bytes(xmp_offset),
    };

    let mut entries: Vec<IfdEntry> = Vec::with_capacity(ifd.entries.len() + 1);
    let mut replaced = false;
    for entry in ifd.entries {
        if entry.tag == TAG_XMP {
            entries.push(IfdEntry {
                tag: TAG_XMP,
                field_type: TIFF_TYPE_BYTE,
                count: xmp_entry.count,
                value: xmp_entry.value,
            });
            replaced = true;
        } else {
            entries.push(entry);
        }
    }
    if !replaced {
        entries.push(xmp_entry);
    }
    entries.sort_by_key(|entry| entry.tag);

    let entry_count = u16::try_from(entries.len()).map_err(|_| AppError::Internal("ifd entry count exceeds u16".to_owned()))?;
    out.extend_from_slice(&endian.u16_bytes(entry_count));
    for entry in &entries {
        out.extend_from_slice(&endian.u16_bytes(entry.tag));
        out.extend_from_slice(&endian.u16_bytes(entry.field_type));
        out.extend_from_slice(&endian.u32_bytes(entry.count));
        out.extend_from_slice(&entry.value);
    }
    out.extend_from_slice(&endian.u32_bytes(ifd.next_offset));

    let header_offset = endian.u32_bytes(new_ifd_offset);
    out[4..8].copy_from_slice(&header_offset);
    Ok(out)
}

static INJECT_SEQ: AtomicU64 = AtomicU64::new(0);

fn temp_sibling(path: &Path) -> PathBuf {
    let ext = path.extension().and_then(|value| value.to_str()).unwrap_or("dng");
    let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or("export");
    let seq = INJECT_SEQ.fetch_add(1, Ordering::Relaxed);
    path.with_file_name(format!("{stem}.xmp-inject-{}-{}.{ext}", std::process::id(), seq))
}

fn compare_meta(pre: &ImageMetadata, post: &ImageMetadata) -> Result<(), String> {
    if pre.file.width != post.file.width || pre.file.height != post.file.height {
        return Err(format!(
            "meta parser dims changed after injection: {:?}x{:?} -> {:?}x{:?}",
            pre.file.width, pre.file.height, post.file.width, post.file.height
        ));
    }
    let pre_corrupt = pre.warnings.iter().any(|warning| matches!(warning, MetadataWarning::CorruptExif));
    let post_corrupt = post.warnings.iter().any(|warning| matches!(warning, MetadataWarning::CorruptExif));
    if post_corrupt && !pre_corrupt {
        return Err("meta parser reports corrupt structure after injection".to_owned());
    }
    Ok(())
}

fn try_inject(dng_path: &Path, packet: &[u8]) -> AppResult<()> {
    let original = std::fs::read(dng_path)?;
    let before = probe_tiff(&original)?;
    let injected = build_injected(&original, packet)?;

    let after = probe_tiff(&injected)?;
    if after.width != before.width || after.height != before.height {
        return Err(AppError::Internal("dng injection altered ifd0 dimensions".to_owned()));
    }
    match after.xmp {
        Some(ref written) if written.as_slice() == packet => {}
        Some(_) => return Err(AppError::Internal("tag 700 payload mismatch after injection".to_owned())),
        None => return Err(AppError::Internal("tag 700 missing after injection".to_owned())),
    }

    let temp = temp_sibling(dng_path);
    std::fs::write(&temp, &injected)?;
    let pre_meta = crate::meta::build_metadata(dng_path);
    let post_meta = crate::meta::build_metadata(&temp);
    if let Err(reason) = compare_meta(&pre_meta, &post_meta) {
        let _ = std::fs::remove_file(&temp);
        return Err(AppError::Internal(reason));
    }
    std::fs::rename(&temp, dng_path)?;
    Ok(())
}

pub fn inject_edit_state(dng_path: &Path, state: &EditState) -> DngXmpOutcome {
    let packet = match crate::xmp::to_xmp_string(dng_path, state, &crate::xmp::OrganizeFields::default()) {
        Ok(xml) => xml.into_bytes(),
        Err(error) => {
            tracing::warn!(%error, "dng xmp serialization failed; keeping un-injected dng");
            return DngXmpOutcome {
                injected: false,
                warning: Some(error.to_string()),
            };
        }
    };
    match try_inject(dng_path, &packet) {
        Ok(()) => DngXmpOutcome {
            injected: true,
            warning: None,
        },
        Err(error) => {
            tracing::warn!(%error, "dng xmp injection failed; keeping un-injected dng");
            DngXmpOutcome {
                injected: false,
                warning: Some(error.to_string()),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edit::default_edit_state;
    use crate::export::dng;
    use crate::types::WbMode;
    use std::path::PathBuf;

    fn push_entry(buffer: &mut Vec<u8>, endian: Endian, tag: u16, field_type: u16, count: u32, value: [u8; 4]) {
        buffer.extend_from_slice(&endian.u16_bytes(tag));
        buffer.extend_from_slice(&endian.u16_bytes(field_type));
        buffer.extend_from_slice(&endian.u32_bytes(count));
        buffer.extend_from_slice(&value);
    }

    fn synthetic_tiff(endian: Endian, width: u32, height: u32, with_xmp: Option<&[u8]>) -> Vec<u8> {
        let mut entries: Vec<(u16, u16, u32, [u8; 4])> = vec![
            (TAG_IMAGE_WIDTH, TIFF_TYPE_LONG, 1, endian.u32_bytes(width)),
            (TAG_IMAGE_LENGTH, TIFF_TYPE_LONG, 1, endian.u32_bytes(height)),
            (274, TIFF_TYPE_SHORT, 1, {
                let short = endian.u16_bytes(1);
                [short[0], short[1], 0, 0]
            }),
        ];
        let ifd_offset: u32 = 8;
        let entry_count = if with_xmp.is_some() { 4 } else { 3 };
        let ifd_end = ifd_offset as usize + 2 + entry_count * ENTRY_LEN + 4;
        if let Some(payload) = with_xmp {
            entries.push((TAG_XMP, TIFF_TYPE_BYTE, payload.len() as u32, endian.u32_bytes(ifd_end as u32)));
        }
        entries.sort_by_key(|entry| entry.0);

        let mut out = Vec::new();
        match endian {
            Endian::Le => out.extend_from_slice(b"II"),
            Endian::Be => out.extend_from_slice(b"MM"),
        }
        out.extend_from_slice(&endian.u16_bytes(42));
        out.extend_from_slice(&endian.u32_bytes(ifd_offset));
        out.extend_from_slice(&endian.u16_bytes(entry_count as u16));
        for (tag, field_type, count, value) in &entries {
            push_entry(&mut out, endian, *tag, *field_type, *count, *value);
        }
        out.extend_from_slice(&endian.u32_bytes(0));
        if let Some(payload) = with_xmp {
            out.extend_from_slice(payload);
        }
        out
    }

    #[test]
    fn injects_tag_700_when_absent() {
        for endian in [Endian::Le, Endian::Be] {
            let tiff = synthetic_tiff(endian, 640, 480, None);
            let packet = b"<x:xmpmeta>hello aether</x:xmpmeta>";
            let out = build_injected(&tiff, packet).unwrap_or_else(|error| panic!("build_injected failed: {error}"));
            let probe = probe_tiff(&out).unwrap_or_else(|error| panic!("probe failed: {error}"));
            assert_eq!(probe.width, Some(640));
            assert_eq!(probe.height, Some(480));
            assert_eq!(probe.xmp.as_deref(), Some(packet.as_slice()));
        }
    }

    #[test]
    fn replaces_existing_tag_700() {
        let tiff = synthetic_tiff(Endian::Le, 800, 600, Some(b"OLD-PLACEHOLDER-XMP-PACKET"));
        let before = probe_tiff(&tiff).unwrap_or_else(|error| panic!("probe failed: {error}"));
        assert_eq!(before.xmp.as_deref(), Some(b"OLD-PLACEHOLDER-XMP-PACKET".as_slice()));

        let packet = b"<x:xmpmeta>replacement packet that is definitely longer than before</x:xmpmeta>";
        let out = build_injected(&tiff, packet).unwrap_or_else(|error| panic!("build_injected failed: {error}"));
        let after = probe_tiff(&out).unwrap_or_else(|error| panic!("probe failed: {error}"));
        assert_eq!(after.width, Some(800));
        assert_eq!(after.height, Some(600));
        assert_eq!(after.xmp.as_deref(), Some(packet.as_slice()));

        let (endian, ifd0) = parse_header(&out).unwrap_or_else(|error| panic!("header failed: {error}"));
        let ifd = parse_ifd(&out, endian, ifd0).unwrap_or_else(|error| panic!("ifd failed: {error}"));
        assert_eq!(ifd.entries.iter().filter(|entry| entry.tag == TAG_XMP).count(), 1);
        assert_eq!(ifd.entries.len(), 4);
    }

    #[test]
    fn preserves_unrelated_tag_values() {
        let tiff = synthetic_tiff(Endian::Le, 1024, 768, None);
        let out = build_injected(&tiff, b"packet").unwrap_or_else(|error| panic!("build_injected failed: {error}"));
        let (endian, ifd0) = parse_header(&out).unwrap_or_else(|error| panic!("header failed: {error}"));
        let ifd = parse_ifd(&out, endian, ifd0).unwrap_or_else(|error| panic!("ifd failed: {error}"));
        let orientation = ifd.entries.iter().find(|entry| entry.tag == 274).unwrap_or_else(|| panic!("orientation tag lost"));
        assert_eq!(scalar_u32(endian, orientation), Some(1));
        assert!(ifd.entries.iter().all(|entry| entry.tag == 274 || entry.tag == TAG_IMAGE_WIDTH || entry.tag == TAG_IMAGE_LENGTH || entry.tag == TAG_XMP));
    }

    #[test]
    fn rejects_non_tiff_input() {
        assert!(build_injected(b"not a tiff at all", b"packet").is_err());
        assert!(probe_tiff(&[0u8; 4]).is_err());
    }

    #[test]
    fn dnglab_dng_injection_round_trip() {
        let binary = dng::binary_path();
        if !binary.exists() {
            eprintln!("SKIP dnglab_dng_injection_round_trip: dnglab binary absent at {}", binary.display());
            return;
        }
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("tests")
            .join("fixtures")
            .join("tier1")
            .join("canon-eos-5d-mark-iii.cr2");
        if !fixture.is_file() {
            eprintln!("SKIP dnglab_dng_injection_round_trip: cr2 fixture absent at {}", fixture.display());
            return;
        }
        let out_dir = std::env::temp_dir().join(format!("raw-viewer-dngxmp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&out_dir);
        let dng_path = match dng::run_convert(&binary, &fixture, &out_dir) {
            Ok(path) => path,
            Err(error) => {
                let _ = std::fs::remove_dir_all(&out_dir);
                panic!("dnglab convert failed: {error}");
            }
        };

        let mut state = default_edit_state();
        state.wb.mode = WbMode::Custom;
        state.wb.temp = 5200.0;
        state.tone.exposure = 0.55;
        state.color.saturation = 18.0;

        let outcome = inject_edit_state(&dng_path, &state);
        assert!(outcome.injected, "injection reported failure: {:?}", outcome.warning);
        assert!(outcome.warning.is_none());

        let injected_bytes = std::fs::read(&dng_path).unwrap_or_else(|error| panic!("read injected dng failed: {error}"));
        let probe = probe_tiff(&injected_bytes).unwrap_or_else(|error| panic!("probe injected dng failed: {error}"));
        let packet = probe.xmp.unwrap_or_else(|| panic!("injected dng missing tag 700"));
        let text = String::from_utf8(packet).unwrap_or_else(|error| panic!("tag 700 not utf-8: {error}"));
        assert!(text.contains("aether:state=\""), "embedded xmp missing aether:state");
        let restored = crate::xmp::from_xmp_string(&text).unwrap_or_else(|error| panic!("from_xmp_string failed: {error}"));
        assert_eq!(restored, state, "embedded xmp did not round-trip the edit state");

        let meta = crate::meta::build_metadata(&dng_path);
        assert!(!meta.warnings.iter().any(|warning| matches!(warning, MetadataWarning::CorruptExif)), "injected dng flagged corrupt: {:?}", meta.warnings);

        let _ = std::fs::remove_dir_all(&out_dir);
    }
}
