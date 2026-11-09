#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Embed the frontend in the binary so frontend changes can reuse the native library.
    brew_lib::run(tauri::generate_context!());
}
