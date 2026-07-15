#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if let Some(code) = raw_viewer_lib::isolate::dispatch_argv(&args) {
        std::process::exit(code);
    }
    raw_viewer_lib::run()
}
