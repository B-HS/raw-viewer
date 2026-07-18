#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

const OMP_TEAM_SIZE: &str = "4";

fn main() {
    if std::env::var_os("OMP_NUM_THREADS").is_none() {
        std::env::set_var("OMP_NUM_THREADS", OMP_TEAM_SIZE);
    }
    if std::env::var_os("KMP_BLOCKTIME").is_none() {
        std::env::set_var("KMP_BLOCKTIME", "0");
    }
    let args: Vec<String> = std::env::args().collect();
    if let Some(code) = raw_viewer_lib::isolate::dispatch_argv(&args) {
        std::process::exit(code);
    }
    raw_viewer_lib::run()
}
