pub mod dock;
pub mod imageio;

use std::path::{Path, PathBuf};
use std::sync::mpsc;

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSDisplayGamut, NSDocumentController, NSPasteboard, NSPasteboardTypePNG, NSPasteboardTypeString, NSPasteboardTypeTIFF, NSPasteboardWriting,
    NSScreen, NSWorkspace, NSWorkspaceOpenConfiguration,
};
use objc2_foundation::{NSArray, NSData, NSString, NSURL};
use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::platform::{AccessToken, ColorSpaceId, DecodedImage, ExternalApp, Platform, RecentItem, TrashToken};

pub struct MacOsPlatform {
    app: AppHandle,
}

impl MacOsPlatform {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

fn on_main<T, F>(app: &AppHandle, work: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce(MainThreadMarker) -> AppResult<T> + Send + 'static,
{
    if let Some(mtm) = MainThreadMarker::new() {
        return work(mtm);
    }
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let outcome = match MainThreadMarker::new() {
            Some(mtm) => work(mtm),
            None => Err(AppError::Internal("platform call not on main thread".to_owned())),
        };
        let _ = tx.send(outcome);
    })
    .map_err(|error| AppError::Internal(format!("main thread dispatch failed: {error}")))?;
    rx.recv().map_err(|error| AppError::Internal(format!("main thread result dropped: {error}")))?
}

fn file_url(path: &Path) -> Retained<NSURL> {
    NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()))
}

impl Platform for MacOsPlatform {
    fn note_recent_document(&self, path: &Path) -> AppResult<()> {
        let path = path.to_path_buf();
        on_main(&self.app, move |mtm| {
            let url = file_url(&path);
            NSDocumentController::sharedDocumentController(mtm).noteNewRecentDocumentURL(&url);
            Ok(())
        })
    }

    fn set_recent_menu(&self, _items: &[RecentItem], _current: Option<&Path>) -> AppResult<()> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn set_progress_badge(&self, _progress: Option<f32>) -> AppResult<()> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn request_attention(&self) -> AppResult<()> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn copy_image(&self, png: &[u8], tiff: Option<&[u8]>) -> AppResult<()> {
        let png = png.to_vec();
        let tiff = tiff.map(<[u8]>::to_vec);
        on_main(&self.app, move |_mtm| {
            let pasteboard = NSPasteboard::generalPasteboard();
            pasteboard.clearContents();
            let png_data = NSData::with_bytes(&png);
            let wrote_png = pasteboard.setData_forType(Some(&png_data), unsafe { NSPasteboardTypePNG });
            let wrote_tiff = match tiff {
                Some(bytes) => {
                    let tiff_data = NSData::with_bytes(&bytes);
                    pasteboard.setData_forType(Some(&tiff_data), unsafe { NSPasteboardTypeTIFF })
                }
                None => true,
            };
            if wrote_png || wrote_tiff {
                Ok(())
            } else {
                Err(AppError::Internal("pasteboard image write failed".to_owned()))
            }
        })
    }

    fn copy_files(&self, paths: &[PathBuf]) -> AppResult<()> {
        if paths.is_empty() {
            return Err(AppError::Internal("no files to copy".to_owned()));
        }
        let paths = paths.to_vec();
        on_main(&self.app, move |_mtm| {
            let pasteboard = NSPasteboard::generalPasteboard();
            pasteboard.clearContents();
            let urls: Vec<Retained<NSURL>> = paths.iter().map(|path| file_url(path)).collect();
            let writers: Vec<&ProtocolObject<dyn NSPasteboardWriting>> = urls.iter().map(|url| ProtocolObject::from_ref(&**url)).collect();
            let array = NSArray::from_slice(&writers);
            if pasteboard.writeObjects(&array) {
                Ok(())
            } else {
                Err(AppError::Internal("pasteboard file write failed".to_owned()))
            }
        })
    }

    fn copy_text(&self, text: &str) -> AppResult<()> {
        let text = text.to_owned();
        on_main(&self.app, move |_mtm| {
            let pasteboard = NSPasteboard::generalPasteboard();
            pasteboard.clearContents();
            if pasteboard.setString_forType(&NSString::from_str(&text), unsafe { NSPasteboardTypeString }) {
                Ok(())
            } else {
                Err(AppError::Internal("pasteboard text write failed".to_owned()))
            }
        })
    }

    fn reveal_in_file_manager(&self, path: &Path) -> AppResult<()> {
        let path = path.to_path_buf();
        on_main(&self.app, move |_mtm| {
            let array = NSArray::from_retained_slice(&[file_url(&path)]);
            NSWorkspace::sharedWorkspace().activateFileViewerSelectingURLs(&array);
            Ok(())
        })
    }

    fn open_with_app(&self, app: &ExternalApp, paths: &[PathBuf]) -> AppResult<()> {
        if paths.is_empty() {
            return Err(AppError::Internal("no files to open".to_owned()));
        }
        let app_path = app.path.clone();
        let paths = paths.to_vec();
        on_main(&self.app, move |_mtm| {
            let app_url = file_url(&app_path);
            let urls: Vec<Retained<NSURL>> = paths.iter().map(|path| file_url(path)).collect();
            let array = NSArray::from_retained_slice(&urls);
            let configuration = NSWorkspaceOpenConfiguration::configuration();
            NSWorkspace::sharedWorkspace().openURLs_withApplicationAtURL_configuration_completionHandler(&array, &app_url, &configuration, None);
            Ok(())
        })
    }

    fn list_default_apps(&self, _ext: &str) -> AppResult<Vec<ExternalApp>> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn display_color_space(&self) -> AppResult<ColorSpaceId> {
        on_main(&self.app, move |mtm| {
            let screen = NSScreen::mainScreen(mtm).ok_or_else(|| AppError::Internal("no main screen".to_owned()))?;
            let space = if screen.canRepresentDisplayGamut(NSDisplayGamut::P3) {
                ColorSpaceId::DisplayP3
            } else {
                ColorSpaceId::Srgb
            };
            Ok(space)
        })
    }

    fn display_icc_profile(&self) -> AppResult<Option<Vec<u8>>> {
        on_main(&self.app, move |mtm| {
            let Some(screen) = NSScreen::mainScreen(mtm) else {
                return Ok(None);
            };
            let Some(space) = screen.colorSpace() else {
                return Ok(None);
            };
            match space.ICCProfileData() {
                Some(data) => Ok(Some(data.to_vec())),
                None => Ok(None),
            }
        })
    }

    fn create_bookmark(&self, _path: &Path) -> AppResult<Vec<u8>> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn resolve_bookmark(&self, _data: &[u8]) -> AppResult<PathBuf> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn start_access(&self, path: &Path) -> AppResult<AccessToken> {
        Ok(AccessToken { path: path.to_path_buf() })
    }

    fn decode_heic(&self, bytes: &[u8]) -> AppResult<DecodedImage> {
        imageio::decode_to_srgb_rgba(bytes, None)
    }

    fn move_to_trash(&self, _paths: &[PathBuf]) -> AppResult<Vec<TrashToken>> {
        Err(AppError::NotSupportedOnPlatform)
    }

    fn restore_from_trash(&self, _token: &TrashToken) -> AppResult<PathBuf> {
        Err(AppError::NotSupportedOnPlatform)
    }
}
