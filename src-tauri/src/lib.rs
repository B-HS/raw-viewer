pub mod cache;
pub mod catalog;
pub mod color;
pub mod commands;
pub mod edit;
pub mod error;
pub mod events;
pub mod export;
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
pub mod types_meta;
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
    let run_result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .register_asynchronous_uri_scheme_protocol("aether", protocol::handle)
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(pipeline::AppState::new(handle));
            app.manage(export::ExportService::new());
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

            let services = app.state::<pipeline::AppState>().services.clone();
            let emit_handle = app.handle().clone();
            let emit: watch::EmitFn = Arc::new(move |payload| {
                if let Err(error) = emit_handle.emit("fs:changed", payload) {
                    tracing::warn!(%error, "emit fs:changed failed");
                }
            });
            let invalidate: watch::InvalidateFn = Arc::new(move |id: &str| {
                services.store.remove(id);
            });
            app.manage(watch::WatchService::new(emit, invalidate));
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                if let Some(edits) = window.try_state::<edit::EditService>() {
                    edits.flush_all();
                }
                if let Some(organize) = window.try_state::<organize::OrganizeService>() {
                    organize.flush_all();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::frontend_ready,
            commands::open_path,
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
            export::commands::export_begin,
            export::commands::export_tile,
            export::commands::export_finish,
            export::commands::export_cancel,
            export::commands::export_dng,
            commands::list_presets,
            commands::save_preset,
            commands::apply_preset,
            commands::delete_preset,
            commands::copy_settings,
        ])
        .run(tauri::generate_context!());
    if let Err(error) = run_result {
        tracing::error!(%error, "tauri run failed");
        std::process::exit(1);
    }
}
