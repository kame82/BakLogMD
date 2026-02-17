#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_error;
mod backlog;
mod commands;
mod db;
mod keychain;
mod markdown;
mod models;

use commands::AppState;

fn main() {
    let state = AppState::new().expect("failed to initialize app state");

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::setup_save,
            commands::setup_load,
            commands::projects_sync,
            commands::issues_search_by_key,
            commands::issues_search_by_keyword,
            commands::issue_get_detail,
            commands::issue_export_markdown,
            commands::exports_list,
            commands::exports_clear,
            commands::set_export_dir,
            commands::auth_reset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
