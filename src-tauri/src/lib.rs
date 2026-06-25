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

#[derive(Serialize)]
struct ExportResult {
    path: String,
    name: String,
}

#[derive(Default)]
struct ExportWindowState(Mutex<Option<serde_json::Value>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HeadingMoveDocuments {
    source_document: TextDocument,
    target_document: Option<TextDocument>,
}

#[derive(Serialize)]
struct ProjectFolder {
    path: String,
    name: String,
    children: Vec<ProjectEntry>,
}

#[derive(Serialize)]
struct ProjectEntry {
    path: String,
    name: String,
    kind: String,
    children: Vec<ProjectEntry>,
}

#[derive(Default, Deserialize, Serialize)]
struct ProjectConfig {
    order: BTreeMap<String, Vec<String>>,
    snippets: Vec<SnippetConfig>,
    #[serde(default, rename = "plotCards")]
    plot_cards: Vec<PlotCardConfig>,
}

#[derive(Clone, Deserialize, Serialize)]
struct SnippetConfig {
    id: String,
    title: String,
    text: String,
    category: String,
    tags: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize)]
struct PlotCardConfig {
    id: String,
    num: String,
    title: String,
    body: String,
    expanded: bool,
}

fn debug_log(message: &str) {
    eprintln!("[folder-debug] {message}");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ExportWindowState::default())
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
            open_export_window,
            get_export_window_payload,
            open_export_location,
            focus_source_in_main,
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
            delete_project_entry,
            reorder_project_entries,
            load_project_snippets,
            save_project_snippets,
            load_project_plot_cards,
            save_project_plot_cards
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
    // The WebView2 drag-and-drop handler must be disabled here, exactly as the
    // main window does via "dragDropEnabled": false in tauri.conf.json. With the
    // default handler enabled, this second webview freezes on Windows: it stays
    // blank/white and stops processing window messages, so it cannot even be
    // closed.
    .disable_drag_drop_handler()
    .build()
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
        || [margin_top_mm, margin_right_mm, margin_bottom_mm, margin_left_mm]
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
                                        .map_err(|error| format!("WebView2 PDF出力に失敗しました: {error}"))
                                        .and_then(|_| {
                                            if succeeded {
                                                Ok(())
                                            } else {
                                                Err("WebView2がPDF出力を完了できませんでした".to_string())
                                            }
                                        });
                                    let _ = callback_sender.send(outcome);
                                    Ok(())
                                },
                            ));
                            core.PrintToPdf(
                                PCWSTR(wide_path.as_ptr()),
                                &settings,
                                &handler,
                            )
                        })
                };

                if let Err(error) = print_result {
                    let _ = sender.send(Err(format!("WebView2 PDF出力を開始できませんでした: {error}")));
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
fn log_heading_dnd(
    stage: String,
    details: serde_json::Value,
    reset: bool,
) -> Result<(), String> {
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
    debug_log(&format!("after blocking_pick_folder selected_path={path:?}"));

    let path = dialog_path_to_path_buf(path)?;
    debug_log(&format!("before list_project_folder path={}", path.display()));
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

    std::fs::rename(&path, &next_path).map_err(|error| format!("failed to rename entry: {error}"))?;
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
fn delete_project_entry(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if path.is_file() {
        return std::fs::remove_file(&path)
            .map_err(|error| format!("failed to delete file: {error}"));
    }

    if path.is_dir() {
        return std::fs::remove_dir(&path)
            .map_err(|error| format!("failed to delete folder; only empty folders can be deleted: {error}"));
    }

    Err("entry does not exist".to_string())
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
fn load_project_snippets(root_path: String) -> Result<Vec<SnippetConfig>, String> {
    let root = PathBuf::from(root_path);
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }

    Ok(load_project_config(&root)?.snippets)
}

#[tauri::command]
fn save_project_snippets(root_path: String, snippets: Vec<SnippetConfig>) -> Result<(), String> {
    let root = PathBuf::from(root_path);
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }

    let mut config = load_project_config(&root)?;
    config.snippets = snippets;
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
    root.join(".brew").join("project.json")
}

fn load_project_config(root: &Path) -> Result<ProjectConfig, String> {
    let path = project_config_path(root);
    if !path.exists() {
        return Ok(ProjectConfig::default());
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|error| format!("failed to read project config: {error}"))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("failed to parse project config: {error}"))
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

fn find_project_root(start: &Path) -> Option<PathBuf> {
    let mut current = start;
    loop {
        if project_config_path(current).exists() {
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
        CreateCompatibleDC, DeleteDC, EnumFontFamiliesExW, LOGFONTW, DEFAULT_CHARSET,
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
    let end = value.iter().position(|code_unit| *code_unit == 0).unwrap_or(value.len());

    String::from_utf16_lossy(&value[..end]).trim().to_string()
}
