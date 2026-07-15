use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use half::f16;
use image::RgbaImage;

use crate::error::{AppError, AppResult};
use crate::types_export::RasterExportRequest;

const MAX_CANVAS_PIXELS: usize = 400_000_000;

pub struct ExportJob {
    pub request: RasterExportRequest,
    pub width: u32,
    pub height: u32,
    pub canvas: Vec<f16>,
    pub tiles_received: u32,
    pub cancel: Arc<AtomicBool>,
    pub watermark: Option<RgbaImage>,
}

impl ExportJob {
    pub fn new(request: RasterExportRequest) -> AppResult<Self> {
        let width = request.source_width;
        let height = request.source_height;
        let pixels = (width as usize)
            .checked_mul(height as usize)
            .ok_or_else(|| AppError::Internal("export canvas dimensions overflow".to_owned()))?;
        if pixels == 0 {
            return Err(AppError::Internal("export canvas has zero area".to_owned()));
        }
        if pixels > MAX_CANVAS_PIXELS {
            return Err(AppError::Internal(format!("export canvas too large: {pixels} pixels")));
        }
        let components = pixels
            .checked_mul(3)
            .ok_or_else(|| AppError::Internal("export canvas component overflow".to_owned()))?;
        Ok(Self {
            request,
            width,
            height,
            canvas: vec![f16::ZERO; components],
            tiles_received: 0,
            cancel: Arc::new(AtomicBool::new(false)),
            watermark: None,
        })
    }

    fn ingest(&mut self, x: u32, y: u32, tile_width: u32, tile_height: u32, rgba_le: &[u8]) -> AppResult<()> {
        let stride = (tile_width as usize).checked_mul(8).ok_or_else(|| AppError::Internal("tile stride overflow".to_owned()))?;
        let required = stride.checked_mul(tile_height as usize).ok_or_else(|| AppError::Internal("tile size overflow".to_owned()))?;
        if rgba_le.len() < required {
            return Err(AppError::Internal(format!("tile payload too small: have {}, need {}", rgba_le.len(), required)));
        }
        let canvas_width = self.width as usize;
        for row in 0..tile_height {
            let dest_y = y as usize + row as usize;
            if dest_y >= self.height as usize {
                break;
            }
            let src_row = row as usize * stride;
            let dest_row = (dest_y * canvas_width + x as usize) * 3;
            for col in 0..tile_width {
                let dest_x = x as usize + col as usize;
                if dest_x >= canvas_width {
                    break;
                }
                let src = src_row + col as usize * 8;
                let dest = dest_row + col as usize * 3;
                self.canvas[dest] = f16::from_le_bytes([rgba_le[src], rgba_le[src + 1]]);
                self.canvas[dest + 1] = f16::from_le_bytes([rgba_le[src + 2], rgba_le[src + 3]]);
                self.canvas[dest + 2] = f16::from_le_bytes([rgba_le[src + 4], rgba_le[src + 5]]);
            }
        }
        self.tiles_received = self.tiles_received.saturating_add(1);
        Ok(())
    }
}

#[derive(Default)]
pub struct ExportService {
    jobs: Mutex<HashMap<String, ExportJob>>,
}

impl ExportService {
    pub fn new() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
        }
    }

    pub fn begin(&self, request: RasterExportRequest) -> AppResult<String> {
        let job = ExportJob::new(request)?;
        let job_id = uuid::Uuid::new_v4().to_string();
        let mut guard = self.jobs.lock().unwrap_or_else(PoisonError::into_inner);
        guard.insert(job_id.clone(), job);
        Ok(job_id)
    }

    pub fn ingest_tile(&self, job_id: &str, x: u32, y: u32, tile_width: u32, tile_height: u32, rgba_le: &[u8]) -> AppResult<()> {
        let mut guard = self.jobs.lock().unwrap_or_else(PoisonError::into_inner);
        let job = guard.get_mut(job_id).ok_or_else(|| AppError::Internal(format!("unknown export job: {job_id}")))?;
        if job.cancel.load(Ordering::Relaxed) {
            return Err(AppError::Internal("export cancelled".to_owned()));
        }
        job.ingest(x, y, tile_width, tile_height, rgba_le)
    }

    pub fn set_watermark(&self, job_id: &str, png: &[u8]) -> AppResult<()> {
        let image = crate::export::watermark::decode(png)?;
        let mut guard = self.jobs.lock().unwrap_or_else(PoisonError::into_inner);
        let job = guard.get_mut(job_id).ok_or_else(|| AppError::Internal(format!("unknown export job: {job_id}")))?;
        job.watermark = Some(image);
        Ok(())
    }

    pub fn take(&self, job_id: &str) -> Option<ExportJob> {
        let mut guard = self.jobs.lock().unwrap_or_else(PoisonError::into_inner);
        guard.remove(job_id)
    }

    pub fn cancel(&self, job_id: &str) {
        let mut guard = self.jobs.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(job) = guard.remove(job_id) {
            job.cancel.store(true, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types_export::{
        ConflictPolicy, ExportColorSpace, ExportMetadata, OutputSharpen, RasterFormat, ResizeMode, ResizeSpec,
    };

    fn request(width: u32, height: u32) -> RasterExportRequest {
        RasterExportRequest {
            image_id: "id".to_owned(),
            format: RasterFormat::Png,
            quality: 90,
            color_space: ExportColorSpace::Srgb,
            bits: 8,
            resize: ResizeSpec {
                mode: ResizeMode::None,
                value: 0.0,
            },
            sharpen: OutputSharpen::None,
            metadata: ExportMetadata::None,
            filename_template: "{name}".to_owned(),
            output_dir: std::path::PathBuf::from("/tmp"),
            conflict: ConflictPolicy::Rename,
            source_width: width,
            source_height: height,
            seq: 1,
            preset_name: None,
        }
    }

    fn tile_bytes(values: &[[f32; 4]]) -> Vec<u8> {
        let mut out = Vec::with_capacity(values.len() * 8);
        for pixel in values {
            for channel in pixel {
                out.extend_from_slice(&f16::from_f32(*channel).to_le_bytes());
            }
        }
        out
    }

    #[test]
    fn begin_rejects_zero_area() {
        let service = ExportService::new();
        assert!(service.begin(request(0, 10)).is_err());
    }

    #[test]
    fn ingest_places_tile_into_interior_region() {
        let service = ExportService::new();
        let Ok(job_id) = service.begin(request(4, 2)) else {
            panic!("begin failed");
        };
        let tile = tile_bytes(&[[0.1, 0.2, 0.3, 1.0], [0.4, 0.5, 0.6, 1.0]]);
        let result = service.ingest_tile(&job_id, 2, 1, 2, 1, &tile);
        assert!(result.is_ok(), "ingest failed: {result:?}");
        let Some(job) = service.take(&job_id) else {
            panic!("take failed");
        };
        assert_eq!(job.tiles_received, 1);
        let base = (1 * 4 + 2) * 3;
        assert!((job.canvas[base].to_f32() - 0.1).abs() < 1e-2);
        assert!((job.canvas[base + 3].to_f32() - 0.4).abs() < 1e-2);
        assert_eq!(job.canvas[0].to_f32(), 0.0);
    }

    #[test]
    fn ingest_rejects_short_payload() {
        let service = ExportService::new();
        let Ok(job_id) = service.begin(request(4, 4)) else {
            panic!("begin failed");
        };
        let result = service.ingest_tile(&job_id, 0, 0, 2, 2, &[0u8, 1, 2]);
        assert!(result.is_err());
    }

    #[test]
    fn cancel_removes_job() {
        let service = ExportService::new();
        let Ok(job_id) = service.begin(request(4, 4)) else {
            panic!("begin failed");
        };
        service.cancel(&job_id);
        assert!(service.take(&job_id).is_none());
    }

    #[test]
    fn unknown_job_ingest_errors() {
        let service = ExportService::new();
        assert!(service.ingest_tile("nope", 0, 0, 1, 1, &[0u8; 8]).is_err());
    }
}
