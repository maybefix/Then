use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
struct TextDocument {
    path: String,
    name: String,
    content: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceFileInfo {
    source_path: String,
    name: String,
    kind: String,
    size: u64,
    imported: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceBinary {
    mime: String,
    data_base64: String,
}

#[derive(Serialize)]
struct ExportResult {
    path: String,
    name: String,
}

#[derive(Default)]
struct ExportWindowState(Mutex<Option<serde_json::Value>>);

#[derive(Default)]
struct CanvasWindowState(Mutex<Option<serde_json::Value>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HeadingMoveDocuments {
    source_document: TextDocument,
    target_document: Option<TextDocument>,
}

#[derive(Clone, Deserialize, Serialize)]
struct ProjectFolder {
    path: String,
    name: String,
    children: Vec<ProjectEntry>,
}

#[derive(Clone, Deserialize, Serialize)]
struct ProjectEntry {
    path: String,
    name: String,
    kind: String,
    children: Vec<ProjectEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MoveProjectEntryResult {
    project_folder: ProjectFolder,
    moved_document: Option<TextDocument>,
    old_path: String,
    new_path: String,
    old_parent_path: String,
    new_parent_path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteProjectEntryPlan {
    root_path: String,
    root_name: String,
    root_kind: String,
    file_count: usize,
    folder_count: usize,
    text_file_count: usize,
    non_text_file_count: usize,
    empty_folder_count: usize,
    total_bytes: u64,
    paths: Vec<String>,
    file_paths: Vec<String>,
    folder_paths: Vec<String>,
    text_file_paths: Vec<String>,
    non_text_file_paths: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteProjectEntryResult {
    deleted_root_path: String,
    deleted_root_name: String,
    deleted_paths: Vec<String>,
    deleted_file_paths: Vec<String>,
    deleted_folder_paths: Vec<String>,
    deleted_text_file_paths: Vec<String>,
    deleted_non_text_file_paths: Vec<String>,
    moved_to_trash: bool,
    trash_path: Option<String>,
    fallback_used: String,
    completed_at: i64,
}

#[derive(Default, Deserialize, Serialize)]
struct ProjectConfig {
    order: BTreeMap<String, Vec<String>>,
    /// 旧 Idea（フラット付箋）。`ideaThreads` への移行用に読み込むだけで、
    /// 保存時にはクリアされる。
    #[serde(default)]
    snippets: Vec<SnippetConfig>,
    #[serde(default, rename = "ideaThreads")]
    idea_threads: Vec<IdeaThreadConfig>,
    #[serde(default, rename = "plotCards")]
    plot_cards: Vec<PlotCardConfig>,
}

/// 旧 Idea スキーマ。移行（`migrate_snippets_to_threads`）でのみ参照する。
#[allow(dead_code)]
#[derive(Clone, Deserialize, Serialize)]
struct SnippetConfig {
    id: String,
    title: String,
    text: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    tags: Vec<String>,
}

fn default_thread_kind() -> String {
    "thread".to_string()
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct IdeaFragmentConfig {
    id: String,
    body: String,
    #[serde(default)]
    used: bool,
    #[serde(default)]
    created_at: i64,
    #[serde(default)]
    updated_at: i64,
    #[serde(default, rename = "originRef", skip_serializing_if = "Option::is_none")]
    origin_ref: Option<serde_json::Value>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct IdeaThreadConfig {
    id: String,
    #[serde(default = "default_thread_kind")]
    kind: String,
    title: String,
    #[serde(default)]
    starred: bool,
    #[serde(default)]
    created_at: i64,
    #[serde(default)]
    updated_at: i64,
    #[serde(default)]
    fragments: Vec<IdeaFragmentConfig>,
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

/// 旧 Idea（フラット付箋）を 1 つのインボックス・スレッドへ移行する。
fn migrate_snippets_to_threads(snippets: &[SnippetConfig]) -> Vec<IdeaThreadConfig> {
    let now = now_millis();
    let fragments = snippets
        .iter()
        .filter_map(|snippet| {
            let body = if !snippet.text.trim().is_empty() {
                snippet.text.clone()
            } else {
                snippet.title.clone()
            };
            if body.trim().is_empty() {
                return None;
            }
            Some(IdeaFragmentConfig {
                id: snippet.id.clone(),
                body,
                used: false,
                created_at: now,
                updated_at: now,
                origin_ref: None,
            })
        })
        .collect();

    vec![IdeaThreadConfig {
        id: "idea-inbox".to_string(),
        kind: "inbox".to_string(),
        title: "インボックス".to_string(),
        starred: false,
        created_at: now,
        updated_at: now,
        fragments,
    }]
}

fn default_plot_card_kind() -> String {
    "section".to_string()
}

#[derive(Clone, Deserialize, Serialize)]
struct PlotCardConfig {
    id: String,
    #[serde(default = "default_plot_card_kind")]
    kind: String,
    num: String,
    title: String,
    body: String,
    expanded: bool,
    #[serde(default, rename = "managerCollapsed")]
    manager_collapsed: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceCardConfig {
    id: String,
    source_path: String,
    kind: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    z_index: i64,
    collapsed: bool,
    pinned: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    scroll_top: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    zoom: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    page: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    editing: Option<bool>,
}

fn default_reference_layout_version() -> i64 {
    1
}

fn default_reference_layout_name() -> String {
    "default".to_string()
}

#[derive(Clone, Deserialize, Serialize)]
struct ReferenceLayoutConfig {
    #[serde(default = "default_reference_layout_version")]
    version: i64,
    #[serde(default = "default_reference_layout_name")]
    name: String,
    #[serde(default)]
    cards: Vec<ReferenceCardConfig>,
    #[serde(default)]
    recent: Vec<ReferenceFileInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanvasBoardSummary {
    id: String,
    name: String,
    path: String,
    scope: String,
    updated_at: i64,
    node_count: usize,
    edge_count: usize,
}

fn debug_log(message: &str) {
    eprintln!("[folder-debug] {message}");
}

const LINKED_CHILD_WINDOW_LABELS: &[&str] = &["linked-export", "linked-export-viewer", "idea-canvas"];

const DISABLE_NATIVE_WEBVIEW_UI_SCRIPT: &str = r#"(function(){
  window.addEventListener('contextmenu', function(event){ event.preventDefault(); }, true);
  window.addEventListener('keydown', function(event){
    if ((event.ctrlKey || event.metaKey) && !event.altKey && String(event.key).toLowerCase() === 'f') {
      event.preventDefault();
    }
  }, true);
})();"#;

fn close_linked_child_windows(app: &tauri::AppHandle) {
    for label in LINKED_CHILD_WINDOW_LABELS {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.close();
        }
    }
}

#[cfg(windows)]
fn disable_webview_native_ui(webview: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows::core::Interface;

    let _ = webview.with_webview(|platform_webview| {
        unsafe {
            if let Ok(settings) = platform_webview
                .controller()
                .CoreWebView2()
                .and_then(|core| core.Settings())
            {
                let _ = settings.SetAreDefaultContextMenusEnabled(false);
                if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
                    let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
                }
            }
        }
    });
}

#[cfg(not(windows))]
fn disable_webview_native_ui(_webview: &tauri::WebviewWindow) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ExportWindowState::default())
        .manage(CanvasWindowState::default())
        .manage(ViewerExportState::default())
        .setup(|app| {
            if let Some(main_window) = app.get_webview_window("main") {
                disable_webview_native_ui(&main_window);
                let app_handle = app.handle().clone();
                main_window.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        close_linked_child_windows(&app_handle);
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_app_state,
            save_app_state,
            get_system_fonts,
            open_text_file_dialog,
            read_text_file,
            save_text_file_dialog,
            save_text_file,
            save_export_file_dialog,
            pick_export_path,
            export_pdf,
            export_pdf_vivliostyle,
            get_viewer_doc,
            viewer_render_done,
            open_export_window,
            get_export_window_payload,
            open_canvas_window,
            get_canvas_window_payload,
            open_export_location,
            focus_source_in_main,
            close_export_window,
            save_heading_move,
            log_heading_dnd,
            open_markdown_file_dialog,
            read_markdown_file,
            save_markdown_file_dialog,
            save_markdown_file,
            open_project_folder_dialog,
            list_project_text_files,
            list_project_markdown_files,
            create_text_file,
            create_markdown_file,
            create_project_folder,
            rename_project_entry,
            plan_delete_project_entry,
            delete_project_entry_to_trash,
            delete_project_entry,
            ensure_project_folder_tree,
            move_project_entry,
            reorder_project_entries,
            load_project_snippets,
            save_project_snippets,
            load_project_plot_cards,
            save_project_plot_cards,
            load_reference_layout,
            save_reference_layout,
            pick_reference_file,
            create_reference_text_file,
            list_reference_candidates,
            delete_imported_reference,
            read_reference_text,
            save_reference_text,
            read_reference_binary,
            list_canvas_boards,
            create_canvas_board,
            load_canvas_board,
            save_canvas_board
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn read_markdown_file(path: String) -> Result<MarkdownDocument, String> {
    read_text_file(path)
}

#[tauri::command]
fn open_markdown_file_dialog(app: tauri::AppHandle) -> Result<Option<MarkdownDocument>, String> {
    open_text_file_dialog(app)
}

#[tauri::command]
fn save_markdown_file_dialog(
    app: tauri::AppHandle,
    content: String,
) -> Result<Option<MarkdownDocument>, String> {
    save_text_file_dialog(app, content)
}

#[tauri::command]
fn save_markdown_file(path: String, content: String) -> Result<MarkdownDocument, String> {
    save_text_file(path, content)
}

#[tauri::command]
fn read_text_file(path: String) -> Result<TextDocument, String> {
    read_text_document(Path::new(&path))
}

#[tauri::command]
fn open_text_file_dialog(app: tauri::AppHandle) -> Result<Option<TextDocument>, String> {
    let Some(path) = app
        .dialog()
        .file()
        .add_filter("Text", &["txt"])
        .add_filter("Markdown", &["md"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };

    read_text_document(&dialog_path_to_path_buf(path)?).map(Some)
}

#[tauri::command]
fn save_text_file_dialog(
    app: tauri::AppHandle,
    content: String,
) -> Result<Option<TextDocument>, String> {
    let Some(path) = app
        .dialog()
        .file()
        .add_filter("Text", &["txt"])
        .add_filter("Markdown", &["md"])
        .set_file_name("untitled.txt")
        .blocking_save_file()
    else {
        return Ok(None);
    };

    let path = ensure_text_extension(dialog_path_to_path_buf(path)?);
    write_text_file(&path, &content)?;
    read_text_document(&path).map(Some)
}

#[tauri::command]
fn save_text_file(path: String, content: String) -> Result<TextDocument, String> {
    let path = PathBuf::from(path);
    write_text_file(&path, &content)?;
    read_text_document(&path)
}

// Must be async: synchronous commands run on the main thread, and
// WebviewWindowBuilder::build() blocks waiting on the main-thread event loop, so
// building a window from a sync command deadlocks — the new webview is created
// but never navigates (stays blank/white) and the command never returns. Running
// async moves this off the main thread so build() can complete.
#[tauri::command]
async fn open_export_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, ExportWindowState>,
    payload: serde_json::Value,
) -> Result<(), String> {
    *state
        .0
        .lock()
        .map_err(|_| "エクスポート画面の状態を更新できませんでした".to_string())? =
        Some(payload.clone());

    if let Some(window) = app.get_webview_window("linked-export") {
        window
            .emit("then-export-payload", payload)
            .map_err(|error| format!("エクスポート画面を更新できませんでした: {error}"))?;
        window
            .show()
            .map_err(|error| format!("エクスポート画面を表示できませんでした: {error}"))?;
        window
            .set_focus()
            .map_err(|error| format!("エクスポート画面を前面に移動できませんでした: {error}"))?;
        return Ok(());
    }

    // NOTE: WebviewUrl::App takes a path (PathBuf), so a "?view=export" query
    // string here is not resolved and the webview ends up on about:blank (blank
    // white, frozen window). The export view is selected by the window label
    // ("linked-export") on the frontend instead — see main.tsx.
    tauri::WebviewWindowBuilder::new(
        &app,
        "linked-export",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Then - エクスポート")
    .inner_size(1240.0, 820.0)
    .min_inner_size(720.0, 560.0)
    .center()
    .initialization_script(DISABLE_NATIVE_WEBVIEW_UI_SCRIPT)
    // The WebView2 drag-and-drop handler must be disabled here, exactly as the
    // main window does via "dragDropEnabled": false in tauri.conf.json. With the
    // default handler enabled, this second webview freezes on Windows: it stays
    // blank/white and stops processing window messages, so it cannot even be
    // closed.
    .disable_drag_drop_handler()
    .build()
    .map(|window| {
        disable_webview_native_ui(&window);
        window
    })
    .map_err(|error| format!("エクスポート画面を開けませんでした: {error}"))?;
    Ok(())
}

#[tauri::command]
fn get_export_window_payload(
    state: tauri::State<'_, ExportWindowState>,
) -> Result<Option<serde_json::Value>, String> {
    state
        .0
        .lock()
        .map_err(|_| "エクスポート画面の状態を取得できませんでした".to_string())
        .map(|payload| payload.clone())
}

#[tauri::command]
async fn open_canvas_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, CanvasWindowState>,
    payload: serde_json::Value,
) -> Result<(), String> {
    *state
        .0
        .lock()
        .map_err(|_| "Canvas画面の状態を更新できませんでした".to_string())? = Some(payload.clone());

    if let Some(window) = app.get_webview_window("idea-canvas") {
        window
            .emit("then-canvas-payload", payload)
            .map_err(|error| format!("Canvas画面を更新できませんでした: {error}"))?;
        window
            .show()
            .map_err(|error| format!("Canvas画面を表示できませんでした: {error}"))?;
        window
            .set_focus()
            .map_err(|error| format!("Canvas画面を前面に移動できませんでした: {error}"))?;
        return Ok(());
    }

    tauri::WebviewWindowBuilder::new(
        &app,
        "idea-canvas",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Then - Idea Board")
    .inner_size(1180.0, 780.0)
    .min_inner_size(820.0, 560.0)
    .center()
    .initialization_script(DISABLE_NATIVE_WEBVIEW_UI_SCRIPT)
    .disable_drag_drop_handler()
    .build()
    .map(|window| {
        disable_webview_native_ui(&window);
        window
    })
    .map_err(|error| format!("Canvas画面を開けませんでした: {error}"))?;
    Ok(())
}

#[tauri::command]
fn get_canvas_window_payload(
    state: tauri::State<'_, CanvasWindowState>,
) -> Result<Option<serde_json::Value>, String> {
    state
        .0
        .lock()
        .map_err(|_| "Canvas画面の状態を取得できませんでした".to_string())
        .map(|payload| payload.clone())
}

#[tauri::command]
fn open_export_location(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|error| format!("保存先を開けませんでした: {error}"))?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let target = path.parent().unwrap_or(&path);
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|error| format!("保存先を開けませんでした: {error}"))?;
        Ok(())
    }
}

#[tauri::command]
fn focus_source_in_main(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "編集画面が見つかりませんでした".to_string())?;
    window
        .emit("then-open-export-source", path)
        .map_err(|error| format!("本文ファイルを編集画面へ渡せませんでした: {error}"))?;
    window
        .show()
        .map_err(|error| format!("編集画面を表示できませんでした: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("編集画面を前面に移動できませんでした: {error}"))?;
    Ok(())
}

// The export window closes itself through this command instead of the frontend
// WebviewWindow.close() API, because that API requires the core:window:allow-close
// capability which this app does not grant — so the close/×/cancel buttons would
// otherwise be silently rejected by the ACL. App-defined commands are not ACL
// gated, so closing from Rust always works.
#[tauri::command]
fn close_export_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("linked-export") {
        window
            .close()
            .map_err(|error| format!("エクスポート画面を閉じられませんでした: {error}"))?;
    }
    Ok(())
}

fn ensure_extension(mut path: PathBuf, extension: &str) -> PathBuf {
    let normalized = extension.trim_start_matches('.');
    if path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case(normalized))
        != Some(true)
    {
        path.set_extension(normalized);
    }
    path
}

fn export_result(path: &Path) -> ExportResult {
    ExportResult {
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_default(),
    }
}

#[tauri::command]
fn save_export_file_dialog(
    app: tauri::AppHandle,
    data_base64: String,
    file_name: String,
    extension: String,
    description: String,
) -> Result<Option<ExportResult>, String> {
    use base64::Engine;

    let Some(path) = app
        .dialog()
        .file()
        .add_filter(&description, &[extension.as_str()])
        .set_file_name(&file_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };

    let path = ensure_extension(dialog_path_to_path_buf(path)?, &extension);
    let data = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|error| format!("エクスポートデータを復号できませんでした: {error}"))?;
    std::fs::write(&path, data)
        .map_err(|error| format!("{} を保存できませんでした: {error}", path.display()))?;
    Ok(Some(export_result(&path)))
}

#[tauri::command]
fn pick_export_path(
    app: tauri::AppHandle,
    file_name: String,
    extension: String,
    description: String,
) -> Result<Option<ExportResult>, String> {
    let Some(path) = app
        .dialog()
        .file()
        .add_filter(&description, &[extension.as_str()])
        .set_file_name(&file_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = ensure_extension(dialog_path_to_path_buf(path)?, &extension);
    Ok(Some(export_result(&path)))
}

// Drives WebView2 PrintToPdf on a specific webview. Shared by the native export
// path (prints the export window) and the Vivliostyle path (prints the hidden
// viewer webview after Vivliostyle has laid the pages out).
#[cfg(windows)]
async fn print_webview_to_pdf(
    webview: tauri::WebviewWindow,
    output_path: PathBuf,
    page_width_mm: f64,
    page_height_mm: f64,
    margin_top_mm: f64,
    margin_right_mm: f64,
    margin_bottom_mm: f64,
    margin_left_mm: f64,
) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_7,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, PCWSTR};

    let wide_path: Vec<u16> = output_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let (sender, receiver) = std::sync::mpsc::channel::<Result<(), String>>();

    webview
        .with_webview(move |platform_webview| {
            let callback_sender = sender.clone();
            let print_result = unsafe {
                platform_webview
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.cast::<ICoreWebView2_7>())
                    .and_then(|core| {
                        let environment = platform_webview
                            .environment()
                            .cast::<ICoreWebView2Environment6>()?;
                        let settings = environment.CreatePrintSettings()?;
                        settings.SetScaleFactor(1.0)?;
                        settings.SetPageWidth(page_width_mm / 25.4)?;
                        settings.SetPageHeight(page_height_mm / 25.4)?;
                        settings.SetMarginTop(margin_top_mm / 25.4)?;
                        settings.SetMarginBottom(margin_bottom_mm / 25.4)?;
                        settings.SetMarginLeft(margin_left_mm / 25.4)?;
                        settings.SetMarginRight(margin_right_mm / 25.4)?;
                        settings.SetShouldPrintBackgrounds(true)?;
                        settings.SetShouldPrintHeaderAndFooter(false)?;
                        let handler = PrintToPdfCompletedHandler::create(Box::new(
                            move |error, succeeded| {
                                let outcome = error
                                    .map_err(|error| {
                                        format!("WebView2 PDF出力に失敗しました: {error}")
                                    })
                                    .and_then(|_| {
                                        if succeeded {
                                            Ok(())
                                        } else {
                                            Err("WebView2がPDF出力を完了できませんでした"
                                                .to_string())
                                        }
                                    });
                                let _ = callback_sender.send(outcome);
                                Ok(())
                            },
                        ));
                        core.PrintToPdf(PCWSTR(wide_path.as_ptr()), &settings, &handler)
                    })
            };

            if let Err(error) = print_result {
                let _ = sender.send(Err(format!(
                    "WebView2 PDF出力を開始できませんでした: {error}"
                )));
            }
        })
        .map_err(|error| format!("WebView2へ接続できませんでした: {error}"))?;

    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv_timeout(Duration::from_secs(90))
            .map_err(|error| format!("WebView2 PDF出力がタイムアウトしました: {error}"))?
    })
    .await
    .map_err(|error| format!("PDF出力処理に失敗しました: {error}"))??;

    Ok(())
}

// State for the Vivliostyle export flow: the source HTML served to the hidden
// viewer webview, and the one-shot channel the viewer signals when CSS paged
// layout is complete.
#[derive(Default)]
struct ViewerExportState {
    html: Mutex<Option<String>>,
    done: Mutex<Option<std::sync::mpsc::Sender<Result<(), String>>>>,
}

// Runs inside the hidden Vivliostyle viewer webview (injected before page
// scripts). On first load it pulls the document and reloads the viewer with it
// as the src; once Vivliostyle reports completion it signals the backend.
const VIEWER_INIT_SCRIPT: &str = r#"(function(){
  try {
    if (String(location.pathname).indexOf('vivliostyle-viewer/index.html') < 0) return;
    function invoke(c,a){ return window.__TAURI_INTERNALS__.invoke(c, a||{}); }
    function done(ok,err){ try{ invoke('viewer_render_done',{ok:ok,error:String(err||'')}); }catch(e){} }
    if (String(location.hash).indexOf('src=') >= 0) {
      var n=0;
      var iv=setInterval(function(){
        n++;
        var b=document.body;
        var st=b?b.getAttribute('data-vivliostyle-viewer-status'):null;
        if(st==='complete'){ clearInterval(iv); done(true,''); }
        else if(n>600){ clearInterval(iv); done(false,'viewer timeout status='+st); }
      },150);
      return;
    }
    invoke('get_viewer_doc').then(function(html){
      var dataUrl='data:text/html;charset=utf-8;base64,'+btoa(unescape(encodeURIComponent(html)));
      location.hash='src='+encodeURIComponent(dataUrl)+'&renderAllPages=true&bookMode=true&spreadView=false';
      location.reload();
    }).catch(function(e){ done(false,'get_viewer_doc '+e); });
  } catch(e) {
    try{ window.__TAURI_INTERNALS__.invoke('viewer_render_done',{ok:false,error:'init '+e}); }catch(_){}
  }
})();"#;

#[tauri::command]
fn get_viewer_doc(state: tauri::State<'_, ViewerExportState>) -> Result<String, String> {
    state
        .html
        .lock()
        .map_err(|_| "Vivliostyle文書の取得に失敗しました".to_string())?
        .clone()
        .ok_or_else(|| "Vivliostyle文書が設定されていません".to_string())
}

#[tauri::command]
fn viewer_render_done(
    state: tauri::State<'_, ViewerExportState>,
    ok: bool,
    error: String,
) -> Result<(), String> {
    if let Some(sender) = state
        .done
        .lock()
        .map_err(|_| "Vivliostyle状態の更新に失敗しました".to_string())?
        .take()
    {
        let outcome = if ok {
            Ok(())
        } else if error.is_empty() {
            Err("Vivliostyleの組版に失敗しました".to_string())
        } else {
            Err(error)
        };
        let _ = sender.send(outcome);
    }
    Ok(())
}

// PDF export via Vivliostyle: lay the flowing HTML out with the bundled
// Vivliostyle Viewer in a hidden webview (CSS Paged Media), then serialize the
// rendered pages with WebView2 PrintToPdf. No Node/Chromium sidecar is used.
#[tauri::command]
async fn export_pdf_vivliostyle(
    app: tauri::AppHandle,
    html: String,
    path: String,
    page_width_mm: f64,
    page_height_mm: f64,
) -> Result<ExportResult, String> {
    if !page_width_mm.is_finite()
        || !page_height_mm.is_finite()
        || !(20.0..=2_000.0).contains(&page_width_mm)
        || !(20.0..=2_000.0).contains(&page_height_mm)
    {
        return Err("PDF用紙サイズが不正です".to_string());
    }
    let output_path = PathBuf::from(&path);
    let result = export_result(&output_path);

    #[cfg(windows)]
    {
        let state = app.state::<ViewerExportState>();
        let (sender, receiver) = std::sync::mpsc::channel::<Result<(), String>>();
        *state
            .html
            .lock()
            .map_err(|_| "Vivliostyle文書を設定できませんでした".to_string())? = Some(html);
        *state
            .done
            .lock()
            .map_err(|_| "Vivliostyle状態を設定できませんでした".to_string())? = Some(sender);

        if let Some(existing) = app.get_webview_window("linked-export-viewer") {
            let _ = existing.close();
        }

        let viewer = tauri::WebviewWindowBuilder::new(
            &app,
            "linked-export-viewer",
            tauri::WebviewUrl::App("vendor/vivliostyle-viewer/index.html".into()),
        )
        .title("Vivliostyle")
        .inner_size(900.0, 1200.0)
        .visible(false)
        .disable_drag_drop_handler()
        .initialization_script(VIEWER_INIT_SCRIPT)
        .build()
        .map(|window| {
            disable_webview_native_ui(&window);
            window
        })
        .map_err(|error| format!("Vivliostyleビューアを開けませんでした: {error}"))?;

        let render = tauri::async_runtime::spawn_blocking(move || {
            receiver.recv_timeout(Duration::from_secs(120))
        })
        .await
        .map_err(|error| format!("Vivliostyle待機に失敗しました: {error}"))?;

        // Always clear the per-export state and the hidden viewer.
        if let Ok(mut guard) = state.html.lock() {
            *guard = None;
        }
        if let Ok(mut guard) = state.done.lock() {
            *guard = None;
        }

        let render =
            render.map_err(|error| format!("Vivliostyle組版がタイムアウトしました: {error}"))?;
        if let Err(message) = render {
            let _ = viewer.close();
            return Err(message);
        }

        let print = print_webview_to_pdf(
            viewer.clone(),
            output_path.clone(),
            page_width_mm,
            page_height_mm,
            0.0,
            0.0,
            0.0,
            0.0,
        )
        .await;
        let _ = viewer.close();
        print?;

        if !output_path.is_file() {
            return Err("PDFファイルが生成されませんでした".to_string());
        }
        return Ok(result);
    }

    #[cfg(not(windows))]
    {
        let _ = (app, html);
        Err("PDF出力は現在Windows版でのみ利用できます".to_string())
    }
}

#[tauri::command]
async fn export_pdf(
    webview: tauri::WebviewWindow,
    path: String,
    page_width_mm: f64,
    page_height_mm: f64,
    margin_top_mm: f64,
    margin_right_mm: f64,
    margin_bottom_mm: f64,
    margin_left_mm: f64,
) -> Result<ExportResult, String> {
    if !page_width_mm.is_finite()
        || !page_height_mm.is_finite()
        || !(20.0..=2_000.0).contains(&page_width_mm)
        || !(20.0..=2_000.0).contains(&page_height_mm)
        || [
            margin_top_mm,
            margin_right_mm,
            margin_bottom_mm,
            margin_left_mm,
        ]
        .iter()
        .any(|margin| !margin.is_finite() || *margin < 0.0)
        || margin_left_mm + margin_right_mm >= page_width_mm
        || margin_top_mm + margin_bottom_mm >= page_height_mm
    {
        return Err("PDF用紙サイズが不正です".to_string());
    }
    let output_path = PathBuf::from(&path);
    let result = export_result(&output_path);

    #[cfg(windows)]
    {
        print_webview_to_pdf(
            webview,
            output_path.clone(),
            page_width_mm,
            page_height_mm,
            margin_top_mm,
            margin_right_mm,
            margin_bottom_mm,
            margin_left_mm,
        )
        .await?;

        if !output_path.is_file() {
            return Err("PDFファイルが生成されませんでした".to_string());
        }
        return Ok(result);
    }

    #[cfg(not(windows))]
    {
        let _ = webview;
        let _ = path;
        Err("PDF出力は現在Windows版でのみ利用できます".to_string())
    }
}

#[tauri::command]
fn save_heading_move(
    source_path: String,
    target_path: String,
    source_content: String,
    target_content: String,
) -> Result<HeadingMoveDocuments, String> {
    let source = PathBuf::from(source_path);
    let target = PathBuf::from(target_path);
    if !source.is_file() || !target.is_file() {
        return Err("heading move source or target does not exist".to_string());
    }
    if !is_supported_text_extension(&source) || !is_supported_text_extension(&target) {
        return Err("heading move supports only text and markdown files".to_string());
    }

    if source == target {
        write_text_file(&source, &source_content)?;
        return Ok(HeadingMoveDocuments {
            source_document: read_text_document(&source)?,
            target_document: None,
        });
    }

    let original_target = std::fs::read_to_string(&target)
        .map_err(|error| format!("failed to back up heading move target: {error}"))?;
    write_text_file(&target, &target_content)?;
    if let Err(source_error) = write_text_file(&source, &source_content) {
        let rollback_result = write_text_file(&target, &original_target);
        return Err(match rollback_result {
            Ok(()) => format!("failed to save heading move source; target was restored: {source_error}"),
            Err(rollback_error) => format!(
                "failed to save heading move source and restore target: {source_error}; {rollback_error}"
            ),
        });
    }

    Ok(HeadingMoveDocuments {
        source_document: read_text_document(&source)?,
        target_document: Some(read_text_document(&target)?),
    })
}

#[tauri::command]
fn log_heading_dnd(stage: String, details: serde_json::Value, reset: bool) -> Result<(), String> {
    let path = std::env::temp_dir().join("then-heading-dnd.log");
    let mut options = std::fs::OpenOptions::new();
    options.create(true).write(true);
    if reset {
        options.truncate(true);
    } else {
        options.append(true);
    }
    let mut file = options
        .open(&path)
        .map_err(|error| format!("failed to open heading drag log: {error}"))?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    writeln!(file, "{timestamp}\t{stage}\t{details}")
        .map_err(|error| format!("failed to write heading drag log: {error}"))?;
    eprintln!("[heading-dnd] {stage} {details}");
    Ok(())
}

#[tauri::command]
fn open_project_folder_dialog(app: tauri::AppHandle) -> Result<Option<ProjectFolder>, String> {
    debug_log("before blocking_pick_folder");
    let Some(path) = app.dialog().file().blocking_pick_folder() else {
        debug_log("after blocking_pick_folder selected_path=None");
        return Ok(None);
    };
    debug_log(&format!(
        "after blocking_pick_folder selected_path={path:?}"
    ));

    let path = dialog_path_to_path_buf(path)?;
    debug_log(&format!(
        "before list_project_folder path={}",
        path.display()
    ));
    let folder = list_project_folder(&path)?;
    debug_log(&format!(
        "after list_project_folder path={} children={}",
        folder.path,
        folder.children.len()
    ));
    Ok(Some(folder))
}

#[tauri::command]
fn list_project_markdown_files(folder_path: String) -> Result<ProjectFolder, String> {
    list_project_text_files(folder_path)
}

#[tauri::command]
fn list_project_text_files(folder_path: String) -> Result<ProjectFolder, String> {
    list_project_folder(Path::new(&folder_path))
}

#[tauri::command]
fn create_markdown_file(folder_path: String, name: String) -> Result<MarkdownDocument, String> {
    create_text_file(folder_path, name)
}

#[tauri::command]
fn create_text_file(folder_path: String, name: String) -> Result<TextDocument, String> {
    let folder = PathBuf::from(folder_path);
    if !folder.is_dir() {
        return Err("folder does not exist".to_string());
    }

    let file_name = normalize_text_file_name(&name)?;
    let stem = file_stem_for_unique_name(&file_name);
    let extension = file_extension_for_unique_name(&file_name);
    let mut path = folder.join(&file_name);
    let mut index = 2;

    while path.exists() {
        path = folder.join(format!("{stem}-{index}.{extension}"));
        index += 1;
    }

    let title = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("新規ノート");
    write_text_file(&path, &format!("# {title}\n"))?;
    read_text_document(&path)
}

#[tauri::command]
fn create_project_folder(folder_path: String, name: String) -> Result<ProjectFolder, String> {
    let folder = PathBuf::from(folder_path);
    if !folder.is_dir() {
        return Err("folder does not exist".to_string());
    }

    let folder_name = normalize_project_entry_name(&name)?;
    let path = folder.join(folder_name);
    if path.exists() {
        return Err("folder already exists".to_string());
    }

    std::fs::create_dir(&path).map_err(|error| format!("failed to create folder: {error}"))?;
    list_project_folder(&folder)
}

#[tauri::command]
fn rename_project_entry(path: String, name: String) -> Result<TextDocument, String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err("entry does not exist".to_string());
    }

    let parent = path
        .parent()
        .ok_or_else(|| "entry parent does not exist".to_string())?;
    let next_name = if path.is_file() {
        normalize_text_file_name(&name)?
    } else {
        normalize_project_entry_name(&name)?
    };
    let next_path = parent.join(next_name);

    if next_path.exists() {
        return Err("entry with that name already exists".to_string());
    }

    std::fs::rename(&path, &next_path)
        .map_err(|error| format!("failed to rename entry: {error}"))?;
    update_project_config_after_rename(&path, &next_path)?;

    if next_path.is_file() {
        read_text_document(&next_path)
    } else {
        Ok(TextDocument {
            path: next_path.to_string_lossy().to_string(),
            name: next_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("folder")
                .to_string(),
            content: String::new(),
        })
    }
}

#[tauri::command]
fn plan_delete_project_entry(
    root_path: String,
    path: String,
) -> Result<DeleteProjectEntryPlan, String> {
    let root = PathBuf::from(root_path);
    let target = PathBuf::from(path);
    create_delete_project_entry_plan(&root, &target)
}

#[tauri::command]
fn delete_project_entry_to_trash(
    app: tauri::AppHandle,
    root_path: String,
    path: String,
) -> Result<DeleteProjectEntryResult, String> {
    let root = PathBuf::from(root_path);
    let target = PathBuf::from(path);
    let plan = create_delete_project_entry_plan(&root, &target)?;
    let source_was_dir = target.is_dir();
    let (trash_path, fallback_used) = match move_project_entry_to_system_trash(&root, &target) {
        Ok(()) => (None, "none".to_string()),
        Err(_) => (
            Some(move_project_entry_to_app_trash(&app, &root, &target)?),
            "appTrash".to_string(),
        ),
    };
    cleanup_project_config_after_delete(&root, &target, source_was_dir)?;

    Ok(DeleteProjectEntryResult {
        deleted_root_path: plan.root_path,
        deleted_root_name: plan.root_name,
        deleted_paths: plan.paths,
        deleted_file_paths: plan.file_paths,
        deleted_folder_paths: plan.folder_paths,
        deleted_text_file_paths: plan.text_file_paths,
        deleted_non_text_file_paths: plan.non_text_file_paths,
        moved_to_trash: true,
        trash_path: trash_path.map(|path| path.to_string_lossy().to_string()),
        fallback_used,
        completed_at: now_millis(),
    })
}

#[tauri::command]
fn ensure_project_folder_tree(root_path: String, tree: ProjectFolder) -> Result<(), String> {
    let root = PathBuf::from(root_path);
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }
    let root_canonical = root
        .canonicalize()
        .map_err(|error| format!("failed to resolve project root: {error}"))?;

    ensure_project_folder_tree_entry(&root, &root_canonical, &tree)
}

#[tauri::command]
fn delete_project_entry(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if path.is_file() {
        return std::fs::remove_file(&path)
            .map_err(|error| format!("failed to delete file: {error}"));
    }

    if path.is_dir() {
        return std::fs::remove_dir(&path).map_err(|error| {
            format!("failed to delete folder; only empty folders can be deleted: {error}")
        });
    }

    Err("entry does not exist".to_string())
}

fn create_delete_project_entry_plan(
    root: &Path,
    target: &Path,
) -> Result<DeleteProjectEntryPlan, String> {
    validate_project_delete_target(root, target)?;

    let root_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("項目")
        .to_string();
    let root_kind = if target.is_dir() { "folder" } else { "file" }.to_string();
    let mut plan = DeleteProjectEntryPlan {
        root_path: target.to_string_lossy().to_string(),
        root_name,
        root_kind,
        file_count: 0,
        folder_count: 0,
        text_file_count: 0,
        non_text_file_count: 0,
        empty_folder_count: 0,
        total_bytes: 0,
        paths: Vec::new(),
        file_paths: Vec::new(),
        folder_paths: Vec::new(),
        text_file_paths: Vec::new(),
        non_text_file_paths: Vec::new(),
        warnings: Vec::new(),
    };

    collect_delete_plan_entry(target, &mut plan)?;
    Ok(plan)
}

fn validate_project_delete_target(root: &Path, target: &Path) -> Result<(), String> {
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }
    if !target.exists() {
        return Err("entry does not exist".to_string());
    }

    let root_canonical = root
        .canonicalize()
        .map_err(|error| format!("failed to resolve project root: {error}"))?;
    let target_canonical = target
        .canonicalize()
        .map_err(|error| format!("failed to resolve entry path: {error}"))?;

    if target_canonical == root_canonical {
        return Err("project root cannot be deleted from the file tree".to_string());
    }
    if !target_canonical.starts_with(&root_canonical) {
        return Err("entry delete must stay inside the project root".to_string());
    }
    if has_reserved_project_component(&target_canonical) {
        return Err("app-managed project entries cannot be deleted".to_string());
    }

    Ok(())
}

fn has_reserved_project_component(path: &Path) -> bool {
    path.components().any(|component| {
        let value = component.as_os_str().to_string_lossy();
        value == ".brew" || value == ".then"
    })
}

fn collect_delete_plan_entry(
    path: &Path,
    plan: &mut DeleteProjectEntryPlan,
) -> Result<(), String> {
    plan.paths.push(path.to_string_lossy().to_string());

    if path.is_file() {
        plan.file_count += 1;
        plan.file_paths.push(path.to_string_lossy().to_string());
        match std::fs::metadata(path) {
            Ok(metadata) => {
                plan.total_bytes = plan.total_bytes.saturating_add(metadata.len());
            }
            Err(error) => plan
                .warnings
                .push(format!("failed to inspect file size: {}: {error}", path.display())),
        }
        if is_supported_text_extension(path) {
            plan.text_file_count += 1;
            plan.text_file_paths
                .push(path.to_string_lossy().to_string());
        } else {
            plan.non_text_file_count += 1;
            plan.non_text_file_paths
                .push(path.to_string_lossy().to_string());
        }
        return Ok(());
    }

    if path.is_dir() {
        plan.folder_count += 1;
        plan.folder_paths.push(path.to_string_lossy().to_string());
        let entries = std::fs::read_dir(path)
            .map_err(|error| format!("failed to read delete target folder: {error}"))?;
        let mut child_count = 0usize;
        for entry in entries {
            let entry = entry.map_err(|error| format!("failed to read folder entry: {error}"))?;
            let child_path = entry.path();
            if child_path
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|name| name == ".brew" || name == ".then")
            {
                plan.warnings.push(format!(
                    "app-managed entry will not be counted: {}",
                    child_path.display()
                ));
                continue;
            }
            child_count += 1;
            collect_delete_plan_entry(&child_path, plan)?;
        }
        if child_count == 0 {
            plan.empty_folder_count += 1;
        }
        return Ok(());
    }

    plan.warnings
        .push(format!("unsupported entry type: {}", path.display()));
    Ok(())
}

fn move_project_entry_to_app_trash(
    app: &tauri::AppHandle,
    root: &Path,
    target: &Path,
) -> Result<PathBuf, String> {
    validate_project_delete_target(root, target)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;
    let workspace_key = hash_path_for_trash(root);
    let trash_root = app_data.join("trash").join(workspace_key);
    std::fs::create_dir_all(&trash_root)
        .map_err(|error| format!("failed to create app trash directory: {error}"))?;

    let target_name = target
        .file_name()
        .ok_or_else(|| "entry name is not available".to_string())?;
    let trash_id = format!("{}-{}", now_millis(), sanitize_trash_name(&target_name.to_string_lossy()));
    let trash_path = trash_root.join(trash_id);

    match std::fs::rename(target, &trash_path) {
        Ok(()) => Ok(trash_path),
        Err(rename_error) => {
            copy_entry_recursively(target, &trash_path).map_err(|copy_error| {
                format!(
                    "failed to move entry to app trash: {rename_error}; copy fallback failed: {copy_error}"
                )
            })?;
            if target.is_dir() {
                std::fs::remove_dir_all(target)
                    .map_err(|error| format!("failed to remove original folder after trash copy: {error}"))?;
            } else {
                std::fs::remove_file(target)
                    .map_err(|error| format!("failed to remove original file after trash copy: {error}"))?;
            }
            Ok(trash_path)
        }
    }
}

#[cfg(windows)]
fn move_project_entry_to_system_trash(root: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::{
        SHFileOperationW, SHFILEOPSTRUCTW, FO_DELETE, FOF_ALLOWUNDO, FOF_NOCONFIRMATION,
        FOF_NOERRORUI, FOF_SILENT,
    };

    validate_project_delete_target(root, target)?;
    let mut from = target
        .as_os_str()
        .encode_wide()
        .chain([0, 0])
        .collect::<Vec<u16>>();
    let flags = (FOF_ALLOWUNDO.0 | FOF_NOCONFIRMATION.0 | FOF_NOERRORUI.0 | FOF_SILENT.0) as u16;
    let mut operation = SHFILEOPSTRUCTW {
        hwnd: HWND::default(),
        wFunc: FO_DELETE,
        pFrom: PCWSTR(from.as_mut_ptr()),
        pTo: PCWSTR::null(),
        fFlags: flags,
        fAnyOperationsAborted: false.into(),
        hNameMappings: std::ptr::null_mut(),
        lpszProgressTitle: PCWSTR::null(),
    };
    let code = unsafe { SHFileOperationW(&mut operation) };
    if code == 0 && !operation.fAnyOperationsAborted.as_bool() {
        Ok(())
    } else {
        Err(format!("system trash operation failed: code={code}"))
    }
}

#[cfg(not(windows))]
fn move_project_entry_to_system_trash(_root: &Path, _target: &Path) -> Result<(), String> {
    Err("system trash is not implemented on this platform".to_string())
}

fn copy_entry_recursively(source: &Path, target: &Path) -> Result<(), String> {
    if source.is_file() {
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create trash parent directory: {error}"))?;
        }
        std::fs::copy(source, target)
            .map_err(|error| format!("failed to copy file to trash: {error}"))?;
        return Ok(());
    }

    if source.is_dir() {
        std::fs::create_dir_all(target)
            .map_err(|error| format!("failed to create trash folder: {error}"))?;
        for entry in std::fs::read_dir(source)
            .map_err(|error| format!("failed to read folder for trash copy: {error}"))?
        {
            let entry = entry.map_err(|error| format!("failed to read folder entry: {error}"))?;
            let child_source = entry.path();
            let child_target = target.join(entry.file_name());
            copy_entry_recursively(&child_source, &child_target)?;
        }
        return Ok(());
    }

    Err("unsupported entry type for trash copy".to_string())
}

fn ensure_project_folder_tree_entry(
    root: &Path,
    root_canonical: &Path,
    folder: &ProjectFolder,
) -> Result<(), String> {
    let path = PathBuf::from(&folder.path);
    let target = if path == root { root.to_path_buf() } else { path };
    let parent = target
        .parent()
        .ok_or_else(|| "folder parent does not exist".to_string())?;
    let parent_canonical = if parent.exists() {
        parent
            .canonicalize()
            .map_err(|error| format!("failed to resolve folder parent: {error}"))?
    } else {
        parent.to_path_buf()
    };
    if !parent_canonical.starts_with(root_canonical) && target != root {
        return Err("folder tree restore must stay inside project root".to_string());
    }
    if has_reserved_project_component(&target) {
        return Err("app-managed project entries cannot be restored from checkpoint".to_string());
    }

    std::fs::create_dir_all(&target)
        .map_err(|error| format!("failed to restore checkpoint folder: {error}"))?;
    for entry in &folder.children {
        if entry.kind == "folder" {
            ensure_project_folder_tree_entry(
                root,
                root_canonical,
                &ProjectFolder {
                    path: entry.path.clone(),
                    name: entry.name.clone(),
                    children: entry.children.clone(),
                },
            )?;
        }
    }
    Ok(())
}

fn cleanup_project_config_after_delete(
    root: &Path,
    deleted_path: &Path,
    deleted_was_dir: bool,
) -> Result<(), String> {
    let mut config = load_project_config(root)?;
    let deleted_name = deleted_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_string();
    if let Some(parent) = deleted_path.parent() {
        let parent_key = project_order_key(root, parent)?;
        if let Some(order) = config.order.get_mut(&parent_key) {
            order.retain(|name| name != &deleted_name);
        }
    }

    if deleted_was_dir {
        let deleted_key = project_order_key(root, deleted_path)?;
        let deleted_prefix = format!("{deleted_key}/");
        config
            .order
            .retain(|key, _| key != &deleted_key && !key.starts_with(&deleted_prefix));
    }

    save_project_config(root, &config)
}

fn hash_path_for_trash(path: &Path) -> String {
    let value = path.to_string_lossy();
    let mut hash = 0xcbf29ce484222325u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn sanitize_trash_name(name: &str) -> String {
    let sanitized = name
        .chars()
        .map(|char| match char {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            value if value.is_control() => '_',
            value => value,
        })
        .collect::<String>();
    if sanitized.trim().is_empty() {
        "entry".to_string()
    } else {
        sanitized
    }
}


#[tauri::command]
fn move_project_entry(
    root_path: String,
    source_path: String,
    target_folder_path: String,
) -> Result<MoveProjectEntryResult, String> {
    let root = PathBuf::from(root_path);
    let source = PathBuf::from(source_path);
    let target_folder = PathBuf::from(target_folder_path);

    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }
    if !source.exists() {
        return Err("entry does not exist".to_string());
    }
    if !target_folder.is_dir() {
        return Err("target folder does not exist".to_string());
    }
    if source.is_file() && !is_supported_text_extension(&source) {
        return Err("only text files can be moved in the project tree".to_string());
    }

    let root_canonical = root
        .canonicalize()
        .map_err(|error| format!("failed to resolve project root: {error}"))?;
    let source_canonical = source
        .canonicalize()
        .map_err(|error| format!("failed to resolve entry path: {error}"))?;
    let target_canonical = target_folder
        .canonicalize()
        .map_err(|error| format!("failed to resolve target folder: {error}"))?;

    if !source_canonical.starts_with(&root_canonical)
        || !target_canonical.starts_with(&root_canonical)
    {
        return Err("entry move must stay inside the project root".to_string());
    }
    if source_canonical == root_canonical {
        return Err("project root cannot be moved".to_string());
    }

    let old_parent = source
        .parent()
        .ok_or_else(|| "entry parent does not exist".to_string())?
        .to_path_buf();
    let old_parent_canonical = old_parent
        .canonicalize()
        .map_err(|error| format!("failed to resolve entry parent: {error}"))?;
    if old_parent_canonical == target_canonical {
        return Err("entry is already in that folder".to_string());
    }

    let file_name = source
        .file_name()
        .ok_or_else(|| "entry name does not exist".to_string())?;
    let next_path = target_folder.join(file_name);
    if next_path.exists() {
        return Err("entry with that name already exists in target folder".to_string());
    }

    let source_is_dir = source.is_dir();
    if source_is_dir && target_canonical.starts_with(&source_canonical) {
        return Err("folder cannot be moved into itself or its descendants".to_string());
    }

    let config_updates = prepare_project_config_after_move(
        &root,
        &source,
        &next_path,
        &old_parent,
        &target_folder,
        source_is_dir,
    )?;

    std::fs::rename(&source, &next_path)
        .map_err(|error| format!("failed to move entry: {error}"))?;
    if let Err(config_error) = save_project_config(&root, &config_updates) {
        return match std::fs::rename(&next_path, &source) {
            Ok(()) => Err(format!("failed to update project config after move: {config_error}")),
            Err(rollback_error) => Err(format!(
                "failed to update project config after move and rollback failed: {config_error}; {rollback_error}"
            )),
        };
    }

    let moved_document = if next_path.is_file() {
        Some(read_text_document(&next_path)?)
    } else {
        None
    };
    let project_folder = list_project_folder(&root)?;

    Ok(MoveProjectEntryResult {
        project_folder,
        moved_document,
        old_path: source.to_string_lossy().to_string(),
        new_path: next_path.to_string_lossy().to_string(),
        old_parent_path: old_parent.to_string_lossy().to_string(),
        new_parent_path: target_folder.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn reorder_project_entries(
    root_path: String,
    folder_path: String,
    ordered_paths: Vec<String>,
) -> Result<ProjectFolder, String> {
    let root = PathBuf::from(root_path);
    let folder = PathBuf::from(folder_path);
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }
    if !folder.is_dir() {
        return Err("folder does not exist".to_string());
    }
    if !folder.starts_with(&root) {
        return Err("folder is outside project root".to_string());
    }

    let mut names = Vec::new();
    for path in ordered_paths {
        let path = PathBuf::from(path);
        if path.parent() != Some(folder.as_path()) {
            return Err("ordered entry is outside target folder".to_string());
        }
        if !path.exists() {
            continue;
        }
        if let Some(name) = path.file_name().and_then(|value| value.to_str()) {
            names.push(name.to_string());
        }
    }

    let mut config = load_project_config(&root)?;
    let key = project_order_key(&root, &folder)?;
    config.order.insert(key, names);
    save_project_config(&root, &config)?;
    Ok(ProjectFolder {
        path: folder.to_string_lossy().to_string(),
        name: folder
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Markdown")
            .to_string(),
        children: list_project_entries(&root, &folder, &config)?,
    })
}

#[tauri::command]
fn load_project_snippets(root_path: String) -> Result<Vec<IdeaThreadConfig>, String> {
    let root = PathBuf::from(root_path);
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }

    let config = load_project_config(&root)?;
    if !config.idea_threads.is_empty() {
        Ok(config.idea_threads)
    } else if !config.snippets.is_empty() {
        Ok(migrate_snippets_to_threads(&config.snippets))
    } else {
        Ok(Vec::new())
    }
}

#[tauri::command]
fn save_project_snippets(root_path: String, snippets: Vec<IdeaThreadConfig>) -> Result<(), String> {
    let root = PathBuf::from(root_path);
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }

    let mut config = load_project_config(&root)?;
    config.idea_threads = snippets;
    // 旧スキーマは移行後に残さない。
    config.snippets = Vec::new();
    save_project_config(&root, &config)
}

#[tauri::command]
fn load_project_plot_cards(root_path: String) -> Result<Vec<PlotCardConfig>, String> {
    let root = PathBuf::from(root_path);
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }

    Ok(load_project_config(&root)?.plot_cards)
}

#[tauri::command]
fn save_project_plot_cards(
    root_path: String,
    plot_cards: Vec<PlotCardConfig>,
) -> Result<(), String> {
    let root = PathBuf::from(root_path);
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }

    let mut config = load_project_config(&root)?;
    config.plot_cards = plot_cards;
    save_project_config(&root, &config)
}

#[tauri::command]
fn load_reference_layout(root_path: String) -> Result<ReferenceLayoutConfig, String> {
    let root = PathBuf::from(root_path);
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }

    let path = reference_layout_path(&root);
    if !path.exists() {
        return Ok(default_reference_layout());
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|error| format!("failed to read reference layout: {error}"))?;
    serde_json::from_str(&content).or_else(|_| Ok(default_reference_layout()))
}

#[tauri::command]
fn save_reference_layout(root_path: String, layout: ReferenceLayoutConfig) -> Result<(), String> {
    let root = PathBuf::from(root_path);
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }

    save_reference_layout_file(&root, &layout)
}

#[tauri::command]
fn list_canvas_boards(
    app: tauri::AppHandle,
    scope: String,
    root_path: Option<String>,
) -> Result<Vec<CanvasBoardSummary>, String> {
    let dir = canvas_boards_dir(&app, &scope, root_path)?;
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("failed to create canvas board directory: {error}"))?;

    let mut boards = Vec::new();
    for entry in std::fs::read_dir(&dir)
        .map_err(|error| format!("failed to read canvas board directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("failed to read canvas board entry: {error}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path
            .extension()
            .and_then(|value| value.to_str())
            .map(|extension| extension.eq_ignore_ascii_case("canvas"))
            != Some(true)
        {
            continue;
        }
        boards.push(canvas_board_summary(&path, &scope)?);
    }

    boards.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(boards)
}

#[tauri::command]
fn create_canvas_board(
    app: tauri::AppHandle,
    scope: String,
    root_path: Option<String>,
    name: String,
) -> Result<CanvasBoardSummary, String> {
    let dir = canvas_boards_dir(&app, &scope, root_path)?;
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("failed to create canvas board directory: {error}"))?;

    let label = if name.trim().is_empty() {
        "Idea Board".to_string()
    } else {
        name.trim().to_string()
    };
    let path = unique_canvas_board_path(&dir, &label);
    let now = now_millis();
    let board = serde_json::json!({
        "nodes": [],
        "edges": [],
        "then": {
            "version": 1,
            "name": label,
            "scope": scope,
            "createdAt": now,
            "updatedAt": now
        }
    });
    write_canvas_board_file(&path, &board)?;
    canvas_board_summary(&path, &scope)
}

#[tauri::command]
fn load_canvas_board(
    app: tauri::AppHandle,
    scope: String,
    root_path: Option<String>,
    board_id: String,
) -> Result<serde_json::Value, String> {
    let dir = canvas_boards_dir(&app, &scope, root_path)?;
    let path = canvas_board_path(&dir, &board_id)?;
    if !path.exists() {
        return Err("canvas board does not exist".to_string());
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|error| format!("failed to read canvas board: {error}"))?;
    serde_json::from_str(&content).map_err(|error| format!("failed to parse canvas board: {error}"))
}

#[tauri::command]
fn save_canvas_board(
    app: tauri::AppHandle,
    scope: String,
    root_path: Option<String>,
    board_id: String,
    mut board: serde_json::Value,
) -> Result<(), String> {
    let dir = canvas_boards_dir(&app, &scope, root_path)?;
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("failed to create canvas board directory: {error}"))?;
    let path = canvas_board_path(&dir, &board_id)?;
    stamp_canvas_board(&mut board, &scope)?;
    write_canvas_board_file(&path, &board)
}

#[tauri::command]
fn pick_reference_file(
    app: tauri::AppHandle,
    root_path: String,
) -> Result<Option<ReferenceFileInfo>, String> {
    let root = PathBuf::from(root_path);
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }

    let Some(path) = app
        .dialog()
        .file()
        .add_filter(
            "Reference",
            &["txt", "md", "png", "jpg", "jpeg", "webp", "pdf"],
        )
        .blocking_pick_file()
    else {
        return Ok(None);
    };

    let path = dialog_path_to_path_buf(path)?;
    if !is_supported_reference_extension(&path) {
        return Err("unsupported reference file type".to_string());
    }

    let imported = import_reference_file(&root, &path)?;
    reference_file_info(&root, &imported).map(Some)
}

#[tauri::command]
fn create_reference_text_file(
    root_path: String,
    name: String,
) -> Result<ReferenceFileInfo, String> {
    let root = PathBuf::from(root_path);
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }

    let file_name = normalize_reference_text_file_name(&name)?;
    let root = root
        .canonicalize()
        .map_err(|error| format!("failed to resolve project root: {error}"))?;
    let imports_dir = reference_imports_dir(&root);
    std::fs::create_dir_all(&imports_dir)
        .map_err(|error| format!("failed to create reference import directory: {error}"))?;

    let path = unique_reference_import_path(&imports_dir, &file_name);
    std::fs::write(&path, "")
        .map_err(|error| format!("failed to create reference file: {error}"))?;
    reference_file_info(&root, &path)
}

#[tauri::command]
fn list_reference_candidates(root_path: String) -> Result<Vec<ReferenceFileInfo>, String> {
    let root = PathBuf::from(root_path);
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }

    let mut files = Vec::new();
    collect_reference_candidates(&root, &root, &mut files)?;
    let imports_dir = reference_imports_dir(&root);
    if imports_dir.is_dir() {
        collect_reference_candidates(&root, &imports_dir, &mut files)?;
    }
    files.sort_by_key(|file| file.source_path.to_lowercase());
    Ok(files)
}

#[tauri::command]
fn delete_imported_reference(root_path: String, source_path: String) -> Result<(), String> {
    let root = PathBuf::from(root_path);
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }

    let path = resolve_reference_source_path(&root, &source_path)?;
    let imports_dir = reference_imports_dir(
        &root
            .canonicalize()
            .map_err(|error| format!("failed to resolve project root: {error}"))?,
    )
    .canonicalize()
    .map_err(|error| format!("failed to resolve reference import directory: {error}"))?;
    if !path.starts_with(&imports_dir) {
        return Err("only imported reference files can be deleted".to_string());
    }

    std::fs::remove_file(&path)
        .map_err(|error| format!("failed to delete imported reference: {error}"))
}

#[tauri::command]
fn read_reference_text(root_path: String, source_path: String) -> Result<String, String> {
    let root = PathBuf::from(root_path);
    let path = resolve_reference_source_path(&root, &source_path)?;
    if !matches!(reference_kind_for_path(&path).as_str(), "text" | "markdown") {
        return Err("reference is not a text file".to_string());
    }

    std::fs::read_to_string(&path)
        .map_err(|error| format!("failed to read reference text: {error}"))
}

#[tauri::command]
fn save_reference_text(root_path: String, source_path: String, text: String) -> Result<(), String> {
    let root = PathBuf::from(root_path);
    let path = resolve_reference_source_path(&root, &source_path)?;
    if !matches!(reference_kind_for_path(&path).as_str(), "text" | "markdown") {
        return Err("reference is not a text file".to_string());
    }

    write_text_file(&path, &text)
}

#[tauri::command]
fn read_reference_binary(
    root_path: String,
    source_path: String,
) -> Result<ReferenceBinary, String> {
    use base64::Engine;

    let root = PathBuf::from(root_path);
    let path = resolve_reference_source_path(&root, &source_path)?;
    let kind = reference_kind_for_path(&path);
    if !matches!(kind.as_str(), "image" | "pdf") {
        return Err("reference is not a binary preview file".to_string());
    }

    let data = std::fs::read(&path)
        .map_err(|error| format!("failed to read reference binary: {error}"))?;
    Ok(ReferenceBinary {
        mime: reference_mime_for_path(&path),
        data_base64: base64::engine::general_purpose::STANDARD.encode(data),
    })
}

fn dialog_path_to_path_buf(path: tauri_plugin_dialog::FilePath) -> Result<PathBuf, String> {
    path.into_path()
        .map_err(|error| format!("selected path is not available as a local file: {error}"))
}

type MarkdownDocument = TextDocument;

fn ensure_text_extension(path: PathBuf) -> PathBuf {
    if is_supported_text_extension(&path) {
        path
    } else {
        let mut value = path.into_os_string();
        value.push(".txt");
        PathBuf::from(value)
    }
}

fn read_text_document(path: &Path) -> Result<TextDocument, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|error| format!("failed to read text file: {error}"))?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("untitled.txt")
        .to_string();

    Ok(TextDocument {
        path: path.to_string_lossy().to_string(),
        name,
        content,
    })
}

fn write_text_file(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create parent directory: {error}"))?;
    }

    std::fs::write(path, content).map_err(|error| format!("failed to write text file: {error}"))
}

fn list_project_folder(path: &Path) -> Result<ProjectFolder, String> {
    if !path.is_dir() {
        return Err("folder does not exist".to_string());
    }
    let config = load_project_config(path)?;

    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Markdown")
        .to_string();

    Ok(ProjectFolder {
        path: path.to_string_lossy().to_string(),
        name,
        children: list_project_entries(path, path, &config)?,
    })
}

fn list_project_entries(
    root: &Path,
    path: &Path,
    config: &ProjectConfig,
) -> Result<Vec<ProjectEntry>, String> {
    let mut entries = Vec::new();
    debug_log(&format!("before read_dir path={}", path.display()));
    for entry in std::fs::read_dir(path)
        .map_err(|error| format!("failed to read project folder: {error}"))?
    {
        let entry = entry.map_err(|error| format!("failed to read folder entry: {error}"))?;
        let entry_path = entry.path();

        if entry_path.file_name().and_then(|value| value.to_str()) == Some(".brew")
            || entry_path.file_name().and_then(|value| value.to_str()) == Some(".then")
        {
            continue;
        }

        if entry_path.is_dir() {
            let name = entry_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("folder")
                .to_string();
            let children = list_project_entries(root, &entry_path, config)?;
            entries.push(ProjectEntry {
                path: entry_path.to_string_lossy().to_string(),
                name,
                kind: "folder".to_string(),
                children,
            });
            continue;
        }

        if !entry_path.is_file() || !is_supported_text_extension(&entry_path) {
            continue;
        }
        let name = entry_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("untitled.txt")
            .to_string();
        entries.push(ProjectEntry {
            path: entry_path.to_string_lossy().to_string(),
            name,
            kind: "file".to_string(),
            children: Vec::new(),
        });
    }
    debug_log(&format!(
        "after read_dir path={} entries={}",
        path.display(),
        entries.len()
    ));

    entries.sort_by_key(|entry| {
        let kind_order = if entry.kind == "folder" { "0" } else { "1" };
        format!("{kind_order}:{}", entry.name.to_lowercase())
    });

    let key = project_order_key(root, path)?;
    if let Some(saved_order) = config.order.get(&key) {
        let order_index: BTreeMap<&str, usize> = saved_order
            .iter()
            .enumerate()
            .map(|(index, name)| (name.as_str(), index))
            .collect();
        entries.sort_by_key(|entry| {
            let kind_order = if entry.kind == "folder" { "0" } else { "1" };
            (
                order_index
                    .get(entry.name.as_str())
                    .copied()
                    .unwrap_or(usize::MAX),
                format!("{kind_order}:{}", entry.name.to_lowercase()),
            )
        });
    }

    Ok(entries)
}

fn project_config_path(root: &Path) -> PathBuf {
    root.join(".then").join("project.json")
}

fn reference_layout_path(root: &Path) -> PathBuf {
    root.join(".then")
        .join("reference-layouts")
        .join("default.json")
}

fn project_canvas_boards_dir(root: &Path) -> PathBuf {
    root.join(".then").join("boards")
}

fn reference_imports_dir(root: &Path) -> PathBuf {
    root.join(".then").join("references").join("imports")
}

fn legacy_project_config_path(root: &Path) -> PathBuf {
    root.join(".brew").join("project.json")
}

fn load_project_config(root: &Path) -> Result<ProjectConfig, String> {
    let path = project_config_path(root);
    let legacy_path = legacy_project_config_path(root);
    let (path, should_migrate) = if path.exists() {
        (path, false)
    } else if legacy_path.exists() {
        (legacy_path, true)
    } else {
        return Ok(ProjectConfig::default());
    };

    let content = std::fs::read_to_string(&path)
        .map_err(|error| format!("failed to read project config: {error}"))?;
    let config: ProjectConfig = serde_json::from_str(&content)
        .map_err(|error| format!("failed to parse project config: {error}"))?;

    if should_migrate {
        save_project_config(root, &config)?;
    }

    Ok(config)
}

fn save_project_config(root: &Path, config: &ProjectConfig) -> Result<(), String> {
    let path = project_config_path(root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create project config directory: {error}"))?;
    }

    let content = serde_json::to_string_pretty(config)
        .map_err(|error| format!("failed to serialize project config: {error}"))?;
    std::fs::write(path, content)
        .map_err(|error| format!("failed to write project config: {error}"))
}

fn default_reference_layout() -> ReferenceLayoutConfig {
    ReferenceLayoutConfig {
        version: 1,
        name: "default".to_string(),
        cards: Vec::new(),
        recent: Vec::new(),
    }
}

fn save_reference_layout_file(root: &Path, layout: &ReferenceLayoutConfig) -> Result<(), String> {
    let path = reference_layout_path(root);
    let parent = path
        .parent()
        .ok_or_else(|| "reference layout directory does not exist".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create reference layout directory: {error}"))?;

    let content = serde_json::to_string_pretty(layout)
        .map_err(|error| format!("failed to serialize reference layout: {error}"))?;
    let tmp_path = path.with_extension("json.tmp");
    let bak_path = path.with_extension("json.bak");

    std::fs::write(&tmp_path, content)
        .map_err(|error| format!("failed to write temporary reference layout: {error}"))?;
    let tmp_content = std::fs::read_to_string(&tmp_path)
        .map_err(|error| format!("failed to verify temporary reference layout: {error}"))?;
    let _: ReferenceLayoutConfig = serde_json::from_str(&tmp_content)
        .map_err(|error| format!("temporary reference layout is invalid: {error}"))?;

    if path.exists() {
        std::fs::copy(&path, &bak_path)
            .map_err(|error| format!("failed to back up reference layout: {error}"))?;
        std::fs::remove_file(&path)
            .map_err(|error| format!("failed to replace old reference layout: {error}"))?;
    }

    std::fs::rename(&tmp_path, &path)
        .map_err(|error| format!("failed to promote reference layout: {error}"))
}

fn canvas_boards_dir(
    app: &tauri::AppHandle,
    scope: &str,
    root_path: Option<String>,
) -> Result<PathBuf, String> {
    match scope {
        "project" => {
            let root_path =
                root_path.ok_or_else(|| "project canvas requires a project root".to_string())?;
            let root = PathBuf::from(root_path);
            if !root.is_dir() {
                return Err("project root does not exist".to_string());
            }
            Ok(project_canvas_boards_dir(&root))
        }
        "global" => {
            let dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("failed to resolve app data directory: {error}"))?;
            Ok(dir.join("boards"))
        }
        _ => Err("unknown canvas scope".to_string()),
    }
}

fn sanitize_canvas_board_id(value: &str) -> String {
    let mut id = String::new();
    let mut last_dash = false;
    for ch in value.trim().to_lowercase().chars() {
        let normalized = if ch.is_alphanumeric() || ch == '_' {
            Some(ch)
        } else if ch.is_whitespace() || ch == '-' {
            Some('-')
        } else {
            None
        };
        if let Some(next) = normalized {
            if next == '-' {
                if !last_dash && !id.is_empty() {
                    id.push('-');
                    last_dash = true;
                }
            } else {
                id.push(next);
                last_dash = false;
            }
        }
    }
    let trimmed = id.trim_matches('-').to_string();
    if trimmed.is_empty() {
        format!("idea-board-{}", now_millis())
    } else {
        trimmed
    }
}

fn canvas_board_path(dir: &Path, board_id: &str) -> Result<PathBuf, String> {
    let sanitized = sanitize_canvas_board_id(board_id);
    if sanitized != board_id {
        return Err("canvas board id is invalid".to_string());
    }
    Ok(dir.join(format!("{sanitized}.canvas")))
}

fn unique_canvas_board_path(dir: &Path, name: &str) -> PathBuf {
    let base = sanitize_canvas_board_id(name);
    let mut index = 1;
    loop {
        let id = if index == 1 {
            base.clone()
        } else {
            format!("{base}-{index}")
        };
        let path = dir.join(format!("{id}.canvas"));
        if !path.exists() {
            return path;
        }
        index += 1;
    }
}

fn canvas_board_summary(path: &Path, scope: &str) -> Result<CanvasBoardSummary, String> {
    let id = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("idea-board")
        .to_string();
    let content = std::fs::read_to_string(path).unwrap_or_default();
    let value: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
    let name = value
        .pointer("/then/name")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(id.as_str())
        .to_string();
    let updated_at = value
        .pointer("/then/updatedAt")
        .and_then(|value| value.as_i64())
        .unwrap_or_else(|| {
            path.metadata()
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as i64)
                .unwrap_or(0)
        });
    let node_count = value
        .get("nodes")
        .and_then(|value| value.as_array())
        .map(|items| items.len())
        .unwrap_or(0);
    let edge_count = value
        .get("edges")
        .and_then(|value| value.as_array())
        .map(|items| items.len())
        .unwrap_or(0);

    Ok(CanvasBoardSummary {
        id,
        name,
        path: path.to_string_lossy().to_string(),
        scope: scope.to_string(),
        updated_at,
        node_count,
        edge_count,
    })
}

fn stamp_canvas_board(board: &mut serde_json::Value, scope: &str) -> Result<(), String> {
    let object = board
        .as_object_mut()
        .ok_or_else(|| "canvas board must be a JSON object".to_string())?;
    object
        .entry("nodes")
        .or_insert_with(|| serde_json::Value::Array(Vec::new()));
    object
        .entry("edges")
        .or_insert_with(|| serde_json::Value::Array(Vec::new()));

    let then = object
        .entry("then")
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    if !then.is_object() {
        *then = serde_json::Value::Object(serde_json::Map::new());
    }
    let then_object = then
        .as_object_mut()
        .ok_or_else(|| "canvas board metadata is invalid".to_string())?;
    then_object.insert("version".to_string(), serde_json::json!(1));
    then_object.insert("scope".to_string(), serde_json::json!(scope));
    then_object.insert("updatedAt".to_string(), serde_json::json!(now_millis()));
    if !then_object
        .get("name")
        .and_then(|value| value.as_str())
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        then_object.insert("name".to_string(), serde_json::json!("Idea Board"));
    }
    if !then_object.contains_key("createdAt") {
        then_object.insert("createdAt".to_string(), serde_json::json!(now_millis()));
    }
    Ok(())
}

fn write_canvas_board_file(path: &Path, board: &serde_json::Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "canvas board directory does not exist".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create canvas board directory: {error}"))?;
    let content = serde_json::to_string_pretty(board)
        .map_err(|error| format!("failed to serialize canvas board: {error}"))?;
    std::fs::write(path, content).map_err(|error| format!("failed to write canvas board: {error}"))
}

fn collect_reference_candidates(
    root: &Path,
    folder: &Path,
    files: &mut Vec<ReferenceFileInfo>,
) -> Result<(), String> {
    for entry in std::fs::read_dir(folder)
        .map_err(|error| format!("failed to read reference candidates: {error}"))?
    {
        let entry = entry.map_err(|error| format!("failed to read reference entry: {error}"))?;
        let path = entry.path();
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("");

        if name == ".then" || name == ".brew" {
            continue;
        }

        if path.is_dir() {
            collect_reference_candidates(root, &path, files)?;
            continue;
        }

        if path.is_file() && is_supported_reference_extension(&path) {
            files.push(reference_file_info(root, &path)?);
        }
    }

    Ok(())
}

fn reference_file_info(root: &Path, path: &Path) -> Result<ReferenceFileInfo, String> {
    let resolved = resolve_reference_absolute_path(root, path)?;
    let metadata = std::fs::metadata(&resolved)
        .map_err(|error| format!("failed to read reference metadata: {error}"))?;
    Ok(ReferenceFileInfo {
        source_path: project_relative_path(root, &resolved)?,
        name: resolved
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("reference")
            .to_string(),
        kind: reference_kind_for_path(&resolved),
        size: metadata.len(),
        imported: is_imported_reference(root, &resolved)?,
    })
}

fn import_reference_file(root: &Path, source: &Path) -> Result<PathBuf, String> {
    let source = source
        .canonicalize()
        .map_err(|error| format!("failed to resolve reference source: {error}"))?;

    let root = root
        .canonicalize()
        .map_err(|error| format!("failed to resolve project root: {error}"))?;
    if source.starts_with(&root) {
        return Ok(source);
    }

    let imports_dir = reference_imports_dir(&root);
    std::fs::create_dir_all(&imports_dir)
        .map_err(|error| format!("failed to create reference import directory: {error}"))?;

    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "reference file name is not valid unicode".to_string())?;
    let destination = unique_reference_import_path(&imports_dir, file_name);
    std::fs::copy(&source, &destination)
        .map_err(|error| format!("failed to copy reference into project: {error}"))?;
    Ok(destination)
}

fn unique_reference_import_path(imports_dir: &Path, file_name: &str) -> PathBuf {
    let mut path = imports_dir.join(file_name);
    if !path.exists() {
        return path;
    }

    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("reference");
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let mut index = 2;

    loop {
        let next_name = if extension.is_empty() {
            format!("{stem}-{index}")
        } else {
            format!("{stem}-{index}.{extension}")
        };
        path = imports_dir.join(next_name);
        if !path.exists() {
            return path;
        }
        index += 1;
    }
}

fn is_imported_reference(root: &Path, path: &Path) -> Result<bool, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("failed to resolve project root: {error}"))?;
    let path = path
        .canonicalize()
        .map_err(|error| format!("failed to resolve reference path: {error}"))?;
    let imports_dir = reference_imports_dir(&root);
    Ok(imports_dir.exists()
        && imports_dir
            .canonicalize()
            .map(|dir| path.starts_with(dir))
            .unwrap_or(false))
}

fn resolve_reference_source_path(root: &Path, source_path: &str) -> Result<PathBuf, String> {
    if source_path.trim().is_empty() {
        return Err("reference path is required".to_string());
    }
    if Path::new(source_path).is_absolute() {
        return Err("reference path must be project-relative".to_string());
    }
    resolve_reference_absolute_path(root, &root.join(source_path))
}

fn resolve_reference_absolute_path(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("failed to resolve project root: {error}"))?;
    let path = path
        .canonicalize()
        .map_err(|error| format!("failed to resolve reference path: {error}"))?;
    if !path.starts_with(&root) {
        return Err("reference file must be inside the project folder".to_string());
    }
    if !path.is_file() {
        return Err("reference file does not exist".to_string());
    }
    if !is_supported_reference_extension(&path) {
        return Err("unsupported reference file type".to_string());
    }
    Ok(path)
}

fn project_relative_path(root: &Path, path: &Path) -> Result<String, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("failed to resolve project root: {error}"))?;
    let relative = path
        .strip_prefix(&root)
        .map_err(|error| format!("failed to make reference path relative: {error}"))?;
    Ok(relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/"))
}

fn is_supported_reference_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_lowercase())
            .as_deref(),
        Some("txt" | "md" | "png" | "jpg" | "jpeg" | "webp" | "pdf")
    )
}

fn reference_kind_for_path(path: &Path) -> String {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_lowercase())
        .as_deref()
    {
        Some("txt") => "text",
        Some("md") => "markdown",
        Some("png" | "jpg" | "jpeg" | "webp") => "image",
        Some("pdf") => "pdf",
        _ => "unknown",
    }
    .to_string()
}

fn reference_mime_for_path(path: &Path) -> String {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("pdf") => "application/pdf",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn update_project_config_after_rename(old_path: &Path, new_path: &Path) -> Result<(), String> {
    let Some(root) = find_project_root(old_path.parent().unwrap_or(old_path)) else {
        return Ok(());
    };

    let old_parent = old_path
        .parent()
        .ok_or_else(|| "entry parent does not exist".to_string())?;
    let old_name = old_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "entry name is not valid unicode".to_string())?;
    let new_name = new_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "entry name is not valid unicode".to_string())?;

    let mut config = load_project_config(&root)?;
    let parent_key = project_order_key(&root, old_parent)?;
    if let Some(order) = config.order.get_mut(&parent_key) {
        for name in order {
            if name == old_name {
                *name = new_name.to_string();
            }
        }
    }

    if old_path.is_dir() || new_path.is_dir() {
        let old_key = project_order_key(&root, old_path)?;
        let new_key = project_order_key(&root, new_path)?;
        let old_prefix = format!("{old_key}/");
        let new_prefix = format!("{new_key}/");
        let mut next_order = BTreeMap::new();

        for (key, value) in config.order {
            let next_key = if key == old_key {
                new_key.clone()
            } else if key.starts_with(&old_prefix) {
                format!("{}{}", new_prefix, &key[old_prefix.len()..])
            } else {
                key
            };
            next_order.insert(next_key, value);
        }
        config.order = next_order;
    }

    save_project_config(&root, &config)
}

fn project_entry_names_in_display_order(
    root: &Path,
    folder: &Path,
    config: &ProjectConfig,
) -> Result<Vec<String>, String> {
    Ok(list_project_entries(root, folder, config)?
        .into_iter()
        .map(|entry| entry.name)
        .collect())
}

fn prepare_project_config_after_move(
    root: &Path,
    old_path: &Path,
    new_path: &Path,
    old_parent: &Path,
    new_parent: &Path,
    source_is_dir: bool,
) -> Result<ProjectConfig, String> {
    let old_name = old_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "entry name is not valid unicode".to_string())?;
    let new_name = new_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "entry name is not valid unicode".to_string())?;

    let mut config = load_project_config(root)?;
    let old_parent_order = project_entry_names_in_display_order(root, old_parent, &config)?
        .into_iter()
        .filter(|name| name != old_name)
        .collect::<Vec<_>>();
    let mut new_parent_order = project_entry_names_in_display_order(root, new_parent, &config)?
        .into_iter()
        .filter(|name| name != new_name)
        .collect::<Vec<_>>();
    new_parent_order.push(new_name.to_string());

    if source_is_dir {
        let old_key = project_order_key(root, old_path)?;
        let new_key = project_order_key(root, new_path)?;
        let old_prefix = format!("{old_key}/");
        let new_prefix = format!("{new_key}/");
        let mut next_order = BTreeMap::new();

        for (key, value) in config.order {
            let next_key = if key == old_key {
                new_key.clone()
            } else if key.starts_with(&old_prefix) {
                format!("{}{}", new_prefix, &key[old_prefix.len()..])
            } else {
                key
            };
            next_order.insert(next_key, value);
        }
        config.order = next_order;
    }

    let old_parent_key = project_order_key(root, old_parent)?;
    let new_parent_key = project_order_key(root, new_parent)?;
    config.order.insert(old_parent_key, old_parent_order);
    config.order.insert(new_parent_key, new_parent_order);

    Ok(config)
}

fn find_project_root(start: &Path) -> Option<PathBuf> {
    let mut current = start;
    loop {
        if project_config_path(current).exists() || legacy_project_config_path(current).exists() {
            return Some(current.to_path_buf());
        }
        current = current.parent()?;
    }
}

fn project_order_key(root: &Path, folder: &Path) -> Result<String, String> {
    let relative = folder
        .strip_prefix(root)
        .map_err(|error| format!("failed to resolve project-relative folder path: {error}"))?;
    if relative.as_os_str().is_empty() {
        return Ok(".".to_string());
    }

    Ok(relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/"))
}

fn normalize_project_entry_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("name is required".to_string());
    }

    if trimmed.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
        return Err("name contains invalid characters".to_string());
    }

    Ok(trimmed.to_string())
}

fn normalize_text_file_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("file name is required".to_string());
    }

    if trimmed.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
        return Err("file name contains invalid characters".to_string());
    }

    let lower = trimmed.to_lowercase();
    if lower.ends_with(".txt") || lower.ends_with(".md") {
        Ok(trimmed.to_string())
    } else {
        Ok(format!("{trimmed}.txt"))
    }
}

fn normalize_reference_text_file_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("file name is required".to_string());
    }

    if trimmed.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
        return Err("file name contains invalid characters".to_string());
    }

    let lower = trimmed.to_lowercase();
    if lower.ends_with(".txt") || lower.ends_with(".md") {
        return Ok(trimmed.to_string());
    }
    if !Path::new(trimmed).extension().is_some() {
        return Ok(format!("{trimmed}.md"));
    }
    Err("reference file must be .txt or .md".to_string())
}

fn is_supported_text_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| {
            let extension = extension.to_lowercase();
            extension == "txt" || extension == "md"
        })
        .unwrap_or(false)
}

fn file_stem_for_unique_name(file_name: &str) -> String {
    Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("untitled")
        .to_string()
}

fn file_extension_for_unique_name(file_name: &str) -> String {
    Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("txt")
        .to_string()
}

fn app_state_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;

    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("failed to create app data directory: {error}"))?;

    Ok(dir.join("app-state.json"))
}

#[tauri::command]
fn load_app_state(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let path = app_state_path(&app)?;

    if !path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|error| format!("failed to read app state: {error}"))?;
    let state = serde_json::from_str(&content)
        .map_err(|error| format!("failed to parse app state: {error}"))?;

    Ok(Some(state))
}

#[tauri::command]
fn save_app_state(app: tauri::AppHandle, state: serde_json::Value) -> Result<(), String> {
    let path = app_state_path(&app)?;
    let content = serde_json::to_string_pretty(&state)
        .map_err(|error| format!("failed to serialize app state: {error}"))?;

    std::fs::write(&path, content).map_err(|error| format!("failed to write app state: {error}"))
}

#[tauri::command]
fn get_system_fonts() -> Result<Vec<String>, String> {
    let mut fonts = std::collections::BTreeSet::new();

    #[cfg(target_os = "windows")]
    {
        collect_windows_font_families(&mut fonts)?;
    }

    if fonts.is_empty() {
        fonts.extend([
            "Arial".to_string(),
            "Consolas".to_string(),
            "Segoe UI".to_string(),
            "Yu Gothic".to_string(),
            "Yu Mincho".to_string(),
        ]);
    }

    Ok(fonts.into_iter().collect())
}

#[cfg(target_os = "windows")]
fn collect_windows_font_families(
    fonts: &mut std::collections::BTreeSet<String>,
) -> Result<(), String> {
    use windows::Win32::Foundation::LPARAM;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, EnumFontFamiliesExW, DEFAULT_CHARSET, LOGFONTW,
    };

    unsafe extern "system" fn enum_font_family(
        log_font: *const LOGFONTW,
        _text_metric: *const windows::Win32::Graphics::Gdi::TEXTMETRICW,
        _font_type: u32,
        lparam: LPARAM,
    ) -> i32 {
        let fonts = &mut *(lparam.0 as *mut std::collections::BTreeSet<String>);
        let Some(log_font) = log_font.as_ref() else {
            return 1;
        };

        let family = wide_null_terminated_to_string(&log_font.lfFaceName);
        if !family.is_empty() && !family.starts_with('@') {
            fonts.insert(family);
        }

        1
    }

    let hdc = unsafe { CreateCompatibleDC(None) };
    if hdc.is_invalid() {
        return Err("failed to create font enumeration device context".to_string());
    }

    let mut log_font = LOGFONTW::default();
    log_font.lfCharSet = DEFAULT_CHARSET;

    let result = unsafe {
        EnumFontFamiliesExW(
            hdc,
            &log_font,
            Some(enum_font_family),
            LPARAM(fonts as *mut _ as isize),
            0,
        )
    };

    unsafe {
        let _ = DeleteDC(hdc);
    }

    if result == 0 && fonts.is_empty() {
        return Err("failed to enumerate system font families".to_string());
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn wide_null_terminated_to_string(value: &[u16]) -> String {
    let end = value
        .iter()
        .position(|code_unit| *code_unit == 0)
        .unwrap_or(value.len());

    String::from_utf16_lossy(&value[..end]).trim().to_string()
}
