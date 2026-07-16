use std::collections::HashMap;
use std::path::Path;

use quick_xml::events::{BytesStart, Event};
use quick_xml::reader::Reader;

use crate::types_lens::{DistortionModel, TcaModel};

#[derive(Debug, Clone, PartialEq)]
pub struct DistortionCalib {
    pub focal: f64,
    pub model: DistortionModel,
    pub terms: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TcaCalib {
    pub focal: f64,
    pub model: TcaModel,
    pub terms: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct VignettingCalib {
    pub focal: f64,
    pub aperture: f64,
    pub distance: f64,
    pub terms: [f64; 3],
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Calibration {
    pub distortion: Vec<DistortionCalib>,
    pub tca: Vec<TcaCalib>,
    pub vignetting: Vec<VignettingCalib>,
}

impl Calibration {
    pub fn is_empty(&self) -> bool {
        self.distortion.is_empty() && self.tca.is_empty() && self.vignetting.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CameraEntry {
    pub maker: String,
    pub model: String,
    pub aliases: Vec<String>,
    pub mount: String,
    pub crop_factor: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LensEntry {
    pub profile_id: String,
    pub maker: String,
    pub model: String,
    pub aliases: Vec<String>,
    pub mounts: Vec<String>,
    pub focal_min: f64,
    pub focal_max: f64,
    pub crop_factor: f64,
    pub calibration: Calibration,
}

impl LensEntry {
    pub fn display_name(&self) -> String {
        let maker_lc = self.maker.to_ascii_lowercase();
        if maker_lc.is_empty() || self.model.to_ascii_lowercase().starts_with(&maker_lc) {
            self.model.clone()
        } else {
            format!("{} {}", self.maker, self.model)
        }
    }
}

#[derive(Debug, Default)]
pub struct LensIndex {
    pub mounts: HashMap<String, Vec<String>>,
    pub cameras: Vec<CameraEntry>,
    pub lenses: Vec<LensEntry>,
    pub by_profile: HashMap<String, usize>,
    pub loaded: bool,
}

impl LensIndex {
    pub fn load_dir(dir: &Path) -> Self {
        let mut index = LensIndex::default();
        let read = match std::fs::read_dir(dir) {
            Ok(read) => read,
            Err(error) => {
                tracing::warn!(dir = %dir.display(), %error, "lensfun db directory unavailable");
                return index;
            }
        };
        index.loaded = true;
        let mut files: Vec<std::path::PathBuf> = read
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.extension().and_then(|value| value.to_str()).map(|ext| ext.eq_ignore_ascii_case("xml")).unwrap_or(false))
            .collect();
        files.sort();
        for file in files {
            match std::fs::read_to_string(&file) {
                Ok(contents) => index.parse_document(&contents),
                Err(error) => tracing::warn!(file = %file.display(), %error, "lensfun xml read failed"),
            }
        }
        for (position, lens) in index.lenses.iter().enumerate() {
            index.by_profile.entry(lens.profile_id.clone()).or_insert(position);
        }
        tracing::info!(cameras = index.cameras.len(), lenses = index.lenses.len(), mounts = index.mounts.len(), "lensfun db indexed");
        index
    }

    pub fn lens_by_profile(&self, profile_id: &str) -> Option<&LensEntry> {
        self.by_profile.get(profile_id).and_then(|position| self.lenses.get(*position))
    }

    #[cfg(test)]
    pub fn from_xml(contents: &str) -> Self {
        let mut index = LensIndex {
            loaded: true,
            ..LensIndex::default()
        };
        index.parse_document(contents);
        for (position, lens) in index.lenses.iter().enumerate() {
            index.by_profile.entry(lens.profile_id.clone()).or_insert(position);
        }
        index
    }

    fn parse_document(&mut self, contents: &str) {
        let mut reader = Reader::from_str(contents);
        reader.config_mut().trim_text(true);

        let mut ctx = Ctx::Root;
        let mut text_tag: Option<Tag> = None;
        let mut mount_name: Option<String> = None;
        let mut mount_compat: Vec<String> = Vec::new();
        let mut camera = CameraBuilder::default();
        let mut lens = LensBuilder::default();

        loop {
            match reader.read_event() {
                Ok(Event::Start(element)) => {
                    match element.name().as_ref() {
                        b"mount" => match ctx {
                            Ctx::Root => {
                                ctx = Ctx::MountDef;
                                mount_name = None;
                                mount_compat.clear();
                            }
                            Ctx::Camera | Ctx::Lens => text_tag = Some(Tag::Mount),
                            _ => {}
                        },
                        b"camera" => {
                            ctx = Ctx::Camera;
                            camera = CameraBuilder::default();
                        }
                        b"lens" => {
                            ctx = Ctx::Lens;
                            lens = LensBuilder::default();
                        }
                        b"calibration" => {
                            if ctx == Ctx::Lens {
                                ctx = Ctx::Calibration;
                            }
                        }
                        b"maker" => text_tag = Some(Tag::Maker),
                        b"model" => text_tag = Some(Tag::Model),
                        b"cropfactor" => text_tag = Some(Tag::Cropfactor),
                        b"name" => text_tag = Some(Tag::Name),
                        b"compat" => text_tag = Some(Tag::Compat),
                        name => handle_leaf(name, &element, &ctx, &mut lens),
                    }
                }
                Ok(Event::Empty(element)) => {
                    handle_leaf(element.name().as_ref(), &element, &ctx, &mut lens);
                }
                Ok(Event::Text(element)) => {
                    if let Some(tag) = text_tag {
                        let value = element.unescape().map(|text| text.trim().to_owned()).unwrap_or_default();
                        if !value.is_empty() {
                            route_text(&ctx, tag, value, &mut mount_name, &mut mount_compat, &mut camera, &mut lens);
                        }
                    }
                }
                Ok(Event::End(element)) => match element.name().as_ref() {
                    b"mount" => {
                        if ctx == Ctx::MountDef {
                            if let Some(name) = mount_name.take() {
                                self.mounts.entry(name).or_default().append(&mut mount_compat);
                            }
                            mount_compat.clear();
                            ctx = Ctx::Root;
                        } else {
                            text_tag = None;
                        }
                    }
                    b"camera" => {
                        if ctx == Ctx::Camera {
                            if let Some(entry) = camera.build() {
                                self.cameras.push(entry);
                            }
                            ctx = Ctx::Root;
                        }
                    }
                    b"lens" => {
                        if ctx == Ctx::Lens {
                            if let Some(entry) = lens.build() {
                                self.lenses.push(entry);
                            }
                            ctx = Ctx::Root;
                        }
                    }
                    b"calibration" => {
                        if ctx == Ctx::Calibration {
                            ctx = Ctx::Lens;
                        }
                    }
                    b"maker" | b"model" | b"cropfactor" | b"name" | b"compat" | b"type" => text_tag = None,
                    _ => {}
                },
                Ok(Event::Eof) => break,
                Err(error) => {
                    tracing::warn!(%error, "lensfun xml parse aborted");
                    break;
                }
                _ => {}
            }
        }
    }
}

#[derive(Debug, PartialEq)]
enum Ctx {
    Root,
    MountDef,
    Camera,
    Lens,
    Calibration,
}

#[derive(Debug, Clone, Copy)]
enum Tag {
    Maker,
    Model,
    Mount,
    Cropfactor,
    Name,
    Compat,
}

#[derive(Debug, Default)]
struct CameraBuilder {
    maker: Option<String>,
    models: Vec<String>,
    mount: Option<String>,
    crop_factor: Option<f64>,
}

impl CameraBuilder {
    fn build(&self) -> Option<CameraEntry> {
        let maker = self.maker.clone()?;
        let (model, aliases) = split_models(&self.models)?;
        let mount = self.mount.clone()?;
        let crop_factor = self.crop_factor.filter(|value| *value > 0.0)?;
        Some(CameraEntry {
            maker,
            model,
            aliases,
            mount,
            crop_factor,
        })
    }
}

#[derive(Debug, Default)]
struct LensBuilder {
    maker: Option<String>,
    models: Vec<String>,
    mounts: Vec<String>,
    focal_min: Option<f64>,
    focal_max: Option<f64>,
    crop_factor: Option<f64>,
    calibration: Calibration,
}

impl LensBuilder {
    fn build(&self) -> Option<LensEntry> {
        let maker = self.maker.clone()?;
        let (model, aliases) = split_models(&self.models)?;
        if self.mounts.is_empty() {
            return None;
        }
        let crop_factor = self.crop_factor.filter(|value| *value > 0.0)?;
        let focal_min = self.focal_min.unwrap_or(0.0);
        let focal_max = self.focal_max.unwrap_or(focal_min);
        let profile_id = profile_id(&maker, &model, &self.mounts);
        Some(LensEntry {
            profile_id,
            maker,
            model,
            aliases,
            mounts: self.mounts.clone(),
            focal_min,
            focal_max,
            crop_factor,
            calibration: self.calibration.clone(),
        })
    }
}

fn split_models(models: &[String]) -> Option<(String, Vec<String>)> {
    let mut iter = models.iter();
    let first = iter.next()?.clone();
    let aliases: Vec<String> = iter.filter(|value| **value != first).cloned().collect();
    Some((first, aliases))
}

fn profile_id(maker: &str, model: &str, mounts: &[String]) -> String {
    let seed = format!("{maker}\u{1f}{model}\u{1f}{}", mounts.join(","));
    blake3::hash(seed.as_bytes()).to_hex().chars().take(16).collect()
}

#[allow(clippy::too_many_arguments)]
fn route_text(
    ctx: &Ctx,
    tag: Tag,
    value: String,
    mount_name: &mut Option<String>,
    mount_compat: &mut Vec<String>,
    camera: &mut CameraBuilder,
    lens: &mut LensBuilder,
) {
    match (ctx, tag) {
        (Ctx::MountDef, Tag::Name) => *mount_name = Some(value),
        (Ctx::MountDef, Tag::Compat) => mount_compat.push(value),
        (Ctx::Camera, Tag::Maker) => camera.maker = Some(value),
        (Ctx::Camera, Tag::Model) => camera.models.push(value),
        (Ctx::Camera, Tag::Mount) => camera.mount = Some(value),
        (Ctx::Camera, Tag::Cropfactor) => camera.crop_factor = value.parse().ok(),
        (Ctx::Lens, Tag::Maker) => lens.maker = Some(value),
        (Ctx::Lens, Tag::Model) => lens.models.push(value),
        (Ctx::Lens, Tag::Mount) => lens.mounts.push(value),
        (Ctx::Lens, Tag::Cropfactor) => lens.crop_factor = value.parse().ok(),
        _ => {}
    }
}

fn handle_leaf(name: &[u8], element: &BytesStart, ctx: &Ctx, lens: &mut LensBuilder) {
    match name {
        b"focal" if matches!(ctx, Ctx::Lens) => {
            let attrs = collect_attrs(element);
            let value = attr_f64(&attrs, "value");
            lens.focal_min = attr_f64(&attrs, "min").or(value).or(lens.focal_min);
            lens.focal_max = attr_f64(&attrs, "max").or(value).or(lens.focal_max);
        }
        b"distortion" if matches!(ctx, Ctx::Calibration) => {
            let attrs = collect_attrs(element);
            if let (Some(focal), Some(model)) = (attr_f64(&attrs, "focal"), attr_str(&attrs, "model")) {
                if let Some(calib) = build_distortion(focal, &model, &attrs) {
                    lens.calibration.distortion.push(calib);
                }
            }
        }
        b"tca" if matches!(ctx, Ctx::Calibration) => {
            let attrs = collect_attrs(element);
            if let (Some(focal), Some(model)) = (attr_f64(&attrs, "focal"), attr_str(&attrs, "model")) {
                if let Some(calib) = build_tca(focal, &model, &attrs) {
                    lens.calibration.tca.push(calib);
                }
            }
        }
        b"vignetting" if matches!(ctx, Ctx::Calibration) => {
            let attrs = collect_attrs(element);
            if let Some(calib) = build_vignetting(&attrs) {
                lens.calibration.vignetting.push(calib);
            }
        }
        _ => {}
    }
}

fn build_distortion(focal: f64, model: &str, attrs: &[(String, String)]) -> Option<DistortionCalib> {
    match model {
        "poly3" => Some(DistortionCalib {
            focal,
            model: DistortionModel::Poly3,
            terms: vec![attr_f64(attrs, "k1").unwrap_or(0.0)],
        }),
        "poly5" => Some(DistortionCalib {
            focal,
            model: DistortionModel::Poly5,
            terms: vec![attr_f64(attrs, "k1").unwrap_or(0.0), attr_f64(attrs, "k2").unwrap_or(0.0)],
        }),
        "ptlens" => Some(DistortionCalib {
            focal,
            model: DistortionModel::Ptlens,
            terms: vec![
                attr_f64(attrs, "a").unwrap_or(0.0),
                attr_f64(attrs, "b").unwrap_or(0.0),
                attr_f64(attrs, "c").unwrap_or(0.0),
            ],
        }),
        _ => None,
    }
}

fn build_tca(focal: f64, model: &str, attrs: &[(String, String)]) -> Option<TcaCalib> {
    match model {
        "linear" => Some(TcaCalib {
            focal,
            model: TcaModel::Linear,
            terms: vec![attr_f64(attrs, "kr").unwrap_or(1.0), attr_f64(attrs, "kb").unwrap_or(1.0)],
        }),
        "poly3" => Some(TcaCalib {
            focal,
            model: TcaModel::Poly3,
            terms: vec![
                attr_f64(attrs, "vr").unwrap_or(1.0),
                attr_f64(attrs, "vb").unwrap_or(1.0),
                attr_f64(attrs, "cr").unwrap_or(0.0),
                attr_f64(attrs, "cb").unwrap_or(0.0),
                attr_f64(attrs, "br").unwrap_or(0.0),
                attr_f64(attrs, "bb").unwrap_or(0.0),
            ],
        }),
        _ => None,
    }
}

fn build_vignetting(attrs: &[(String, String)]) -> Option<VignettingCalib> {
    if attr_str(attrs, "model").as_deref() != Some("pa") {
        return None;
    }
    Some(VignettingCalib {
        focal: attr_f64(attrs, "focal")?,
        aperture: attr_f64(attrs, "aperture")?,
        distance: attr_f64(attrs, "distance")?,
        terms: [
            attr_f64(attrs, "k1").unwrap_or(0.0),
            attr_f64(attrs, "k2").unwrap_or(0.0),
            attr_f64(attrs, "k3").unwrap_or(0.0),
        ],
    })
}

fn collect_attrs(element: &BytesStart) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for attribute in element.attributes().flatten() {
        let key = String::from_utf8_lossy(attribute.key.as_ref()).into_owned();
        let value = attribute
            .unescape_value()
            .map(|text| text.into_owned())
            .unwrap_or_else(|_| String::from_utf8_lossy(&attribute.value).into_owned());
        out.push((key, value));
    }
    out
}

fn attr_str(attrs: &[(String, String)], key: &str) -> Option<String> {
    attrs.iter().find(|(name, _)| name == key).map(|(_, value)| value.clone())
}

fn attr_f64(attrs: &[(String, String)], key: &str) -> Option<f64> {
    attrs.iter().find(|(name, _)| name == key).and_then(|(_, value)| value.trim().parse().ok())
}
