pub mod about;
pub mod cache;
pub mod catalog;
pub mod color;
pub mod commands;
pub mod cpurender;
pub mod edit;
pub mod error;
pub mod events;
pub mod exiftool;
pub mod export;
pub mod geocode;
pub mod isolate;
pub mod lens;
pub mod meta;
pub mod organize;
pub mod pipeline;
pub mod platform;
pub mod preset;
pub mod protocol;
pub mod scan;
pub mod trashbin;
pub mod types;
pub mod types_export;
pub mod types_lens;
pub mod types_meta;
pub mod types_cpurender;
pub mod types_performance;
pub mod types_platform;
pub mod types_preset;
pub mod watch;
pub mod xmp;

#[cfg(feature = "libraw")]
pub mod decode;

use std::sync::Arc;

use tauri::{Emitter, Manager};

fn init_tracing() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt().with_env_filter(filter).init();
}

pub fn run() {
    init_tracing();
    let build_result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(arg) = argv.iter().skip(1).find(|value| !value.starts_with('-')) {
                platform::handle_open(app, std::path::PathBuf::from(arg));
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol("aether", protocol::handle)
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(pipeline::AppState::new(handle));
            app.manage(export::ExportService::new());
            app.manage(cpurender::CpuFrameStore::new());
            app.manage(platform::OpenQueue::new());
            #[cfg(target_os = "macos")]
            app.manage(platform::macos::MacOsPlatform::new(app.handle().clone()));
            let recents_service = match platform::RecentsService::open_default() {
                Ok(service) => service,
                Err(error) => {
                    tracing::error!(%error, "recents catalog open failed; falling back to in-memory catalog");
                    platform::RecentsService::open_memory().map_err(|inner| Box::<dyn std::error::Error>::from(inner.to_string()))?
                }
            };
            app.manage(recents_service);
            let edit_service = match edit::EditService::open_default() {
                Ok(service) => service,
                Err(error) => {
                    tracing::error!(%error, "catalog open failed; falling back to in-memory catalog");
                    edit::EditService::open_memory().map_err(|inner| Box::<dyn std::error::Error>::from(inner.to_string()))?
                }
            };
            app.manage(edit_service);

            let organize_service = match organize::OrganizeService::open_default() {
                Ok(service) => service,
                Err(error) => {
                    tracing::error!(%error, "organize catalog open failed; falling back to in-memory catalog");
                    organize::OrganizeService::open_memory().map_err(|inner| Box::<dyn std::error::Error>::from(inner.to_string()))?
                }
            };
            app.manage(organize_service);

            let preset_service = match preset::PresetService::open_default() {
                Ok(service) => service,
                Err(error) => {
                    tracing::error!(%error, "preset catalog open failed; falling back to in-memory catalog");
                    preset::PresetService::open_memory().map_err(|inner| Box::<dyn std::error::Error>::from(inner.to_string()))?
                }
            };
            app.manage(preset_service);

            let lens_db_dir = app
                .path()
                .resolve("resources/lensfun", tauri::path::BaseDirectory::Resource)
                .unwrap_or_else(|_| std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/lensfun"));
            let lens_service = match lens::LensService::open_default(lens_db_dir.clone()) {
                Ok(service) => service,
                Err(error) => {
                    tracing::error!(%error, "lens catalog open failed; falling back to in-memory catalog");
                    lens::LensService::open_memory(lens_db_dir).map_err(|inner| Box::<dyn std::error::Error>::from(inner.to_string()))?
                }
            };
            app.manage(lens_service);

            let services = app.state::<pipeline::AppState>().services.clone();
            let emit_handle = app.handle().clone();
            let emit: watch::EmitFn = Arc::new(move |payload| {
                if let Err(error) = emit_handle.emit(events::EVENT_FS_CHANGED, payload) {
                    tracing::warn!(%error, "emit fs:changed failed");
                }
            });
            let invalidate: watch::InvalidateFn = Arc::new(move |id: &str| {
                services.store.remove(id);
            });
            app.manage(watch::WatchService::new(emit, invalidate));
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { .. } => {
                if let Some(edits) = window.try_state::<edit::EditService>() {
                    edits.flush_all();
                }
                if let Some(organize) = window.try_state::<organize::OrganizeService>() {
                    organize.flush_all();
                }
            }
            tauri::WindowEvent::Destroyed => {
                if let Some(state) = window.try_state::<pipeline::AppState>() {
                    state.pipeline.forget_window(window.label());
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::frontend_ready,
            commands::open_path,
            commands::open_in_new_window,
            commands::scan_directory,
            commands::navigate,
            commands::get_edit_state,
            commands::set_edit_state,
            commands::reset_edit_state,
            commands::flush_edits,
            commands::get_metadata,
            commands::set_rating,
            commands::set_flag,
            commands::set_label,
            commands::get_organize,
            commands::flush_organize,
            commands::move_to_trash,
            commands::watch_directory,
            commands::render_cpu_frame,
            commands::set_performance_settings,
            commands::get_performance_settings,
            commands::request_l2,
            commands::get_reverse_geocode,
            export::commands::export_begin,
            export::commands::export_tile,
            export::commands::export_set_watermark,
            export::commands::read_watermark_png,
            export::commands::export_finish,
            export::commands::export_cancel,
            export::commands::export_dng,
            export::handoff::open_with_edited,
            commands::list_presets,
            commands::save_preset,
            commands::apply_preset,
            commands::delete_preset,
            commands::export_preset,
            commands::import_preset,
            commands::copy_settings,
            commands::toggle_fullscreen,
            commands::fullscreen_state,
            commands::register_image,
            commands::probe_capture_dates,
            exiftool::detect_exiftool,
            exiftool::get_deep_metadata,
            lens::find_lens_profile,
            lens::list_lens_profiles,
            lens::set_lens_override,
            about::licenses::get_licenses,
            about::cache::get_cache_stats,
            about::cache::clear_cache,
            platform::commands::copy_image_to_clipboard,
            platform::commands::copy_files_to_clipboard,
            platform::commands::copy_text,
            platform::commands::get_pairs,
            platform::commands::note_recent,
            platform::commands::get_recents,
            platform::commands::clear_recents,
            platform::commands::get_display_color_space,
            platform::commands::has_display_icc_profile,
            platform::commands::get_display_lut,
            platform::commands::reveal_in_file_manager,
            platform::commands::open_with_external,
        ])
        .build(tauri::generate_context!());
    let app = match build_result {
        Ok(app) => app,
        Err(error) => {
            tracing::error!(%error, "tauri build failed");
            std::process::exit(1);
        }
    };
    app.run(|app_handle, event| match event {
        tauri::RunEvent::Ready => {
            #[cfg(target_os = "macos")]
            platform::macos::dock::install(app_handle);
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    platform::handle_open(app_handle, path);
                }
            }
        }
        _ => {}
    });
}
