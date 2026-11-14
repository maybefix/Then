//! Plot → ノート「プロット（移行）」（BINDER 1-6、docs/BINDER_PLOT_MIGRATION_PLAN.md）。
//!
//! 画面の側が `plotCards` を読み、見えていた形でノートの文字を作って、読んだときのままの `plotCards` と一緒に
//! 渡す。ここでは `project.json` の鍵を取ったまま、読み直して同じであることを確かめてから、
//! バックアップ → 素材フォルダ（なければ作る）→ ノート → 空の `plotCards` と移行の印、の順に書く。
//! 途中で失敗したら、その回に作ったノートと素材フォルダを消し、`project.json` は書かない。
//! `plotCards` が空になること自体が「済んだ」の印なので、何度呼んでも1回しか移さない。

use super::project_state::{
    load_project_config_unlocked, lock_project_config, save_project_config_unlocked,
    PlotMigrationRecord,
};
use super::{library, normalize_text_file_name, now_millis, PlotCardConfig};
use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};

/// 素材フォルダがない作品に作るフォルダの名前（計画書 3.6）。
const MATERIALS_FOLDER_NAME: &str = "素材";

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PlotMigrationResult {
    /// migrated: 今回移した。empty: `plotCards` が空なので何もしなかった（移行済みを含む）。
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    note_path: Option<String>,
}

fn relative_slash_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/")
}

/// `name`、`name-2`、`name-3` … の順に、`exists` が偽になる最初の名前。
fn first_free_name(stem: &str, extension: &str, exists: impl Fn(&str) -> bool) -> String {
    let mut index = 1;
    loop {
        let candidate = if index == 1 {
            format!("{stem}{extension}")
        } else {
            format!("{stem}-{index}{extension}")
        };
        if !exists(&candidate) {
            return candidate;
        }
        index += 1;
    }
}

/// 1970-01-01 からの日数を、グレゴリオ暦の年月日にする（UTC）。
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// バックアップのファイル名に使う日時（UTC、`20261114-031500`）。
fn backup_stamp(millis: i64) -> String {
    let seconds = millis.div_euclid(1_000);
    let (year, month, day) = civil_from_days(seconds.div_euclid(86_400));
    let in_day = seconds.rem_euclid(86_400);
    format!(
        "{year:04}{month:02}{day:02}-{:02}{:02}{:02}",
        in_day / 3_600,
        in_day % 3_600 / 60,
        in_day % 60
    )
}

fn write_new_file(path: &Path, content: &[u8]) -> Result<(), String> {
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("failed to create {}: {error}", path.display()))?;
    file.write_all(content)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("failed to write {}: {error}", path.display()))
}

/// 元の `plotCards` を ID・開閉の状態ごとそのまま書き、読み戻して同じことを確かめる。
fn write_backup(root: &Path, cards: &[PlotCardConfig], migrated_at: i64) -> Result<PathBuf, String> {
    let dir = root.join(".then").join("backups");
    std::fs::create_dir_all(&dir).map_err(|error| format!("failed to create backup folder: {error}"))?;
    let stem = format!("plot-cards-{}", backup_stamp(migrated_at));
    let name = first_free_name(&stem, ".json", |candidate| dir.join(candidate).exists());
    let path = dir.join(name);
    let content = serde_json::to_string_pretty(&serde_json::json!({
        "plotCards": cards,
        "migratedAt": migrated_at,
    }))
    .map_err(|error| format!("failed to serialize plot backup: {error}"))?;
    write_new_file(&path, content.as_bytes())?;
    let reread: serde_json::Value = std::fs::read_to_string(&path)
        .map_err(|error| format!("failed to read plot backup: {error}"))
        .and_then(|text| serde_json::from_str(&text).map_err(|error| format!("plot backup is broken: {error}")))?;
    let reread_cards: Vec<PlotCardConfig> = serde_json::from_value(reread["plotCards"].clone())
        .map_err(|error| format!("plot backup is broken: {error}"))?;
    if reread_cards != cards {
        return Err("plot backup does not match the plot cards".to_string());
    }
    Ok(path)
}

/// ノートを置くフォルダ。ライブラリ直下は三段でないのでそのまま。作品は素材フォルダで、なければ「素材」を作る。
/// 登録されていないふつうのフォルダ「素材」があれば、それは原稿なので使わず「素材-2」を作る（確認1の 2）。
/// 返り値の2つ目は、今回作ったフォルダ（失敗したら消す）。
fn note_folder(root: &Path, materials_folder: Option<&str>) -> Result<(PathBuf, Option<String>), String> {
    if library::is_library_root(root) {
        return Ok((root.to_path_buf(), None));
    }
    if let Some(name) = materials_folder {
        let folder = root.join(name);
        if folder.is_dir() {
            return Ok((folder, None));
        }
    }
    let name = first_free_name(MATERIALS_FOLDER_NAME, "", |candidate| root.join(candidate).exists());
    let folder = root.join(&name);
    std::fs::create_dir(&folder).map_err(|error| format!("failed to create materials folder: {error}"))?;
    Ok((folder, Some(name)))
}

/// ノートを書く。同じ名前があれば `-2` … にする。ただし同じ中身のノートがすでにあれば、それを使う
/// （前回、ノートを書いたあとで止まった場合に2本目を作らない）。返り値の2つ目は、今回書いたかどうか。
fn write_note(folder: &Path, note_name: &str, note_text: &str) -> Result<(PathBuf, bool), String> {
    let file_name = normalize_text_file_name(&format!("{note_name}.md"))?;
    let stem = file_name.strip_suffix(".md").unwrap_or(&file_name).to_string();
    let mut index = 1;
    loop {
        let candidate = if index == 1 {
            folder.join(&file_name)
        } else {
            folder.join(format!("{stem}-{index}.md"))
        };
        if !candidate.exists() {
            write_new_file(&candidate, note_text.as_bytes())?;
            return Ok((candidate, true));
        }
        if std::fs::read(&candidate).map(|bytes| bytes == note_text.as_bytes()).unwrap_or(false) {
            return Ok((candidate, false));
        }
        index += 1;
    }
}

pub(super) fn migrate_plot_to_note(
    root: &Path,
    expected_plot_cards: &[PlotCardConfig],
    note_name: &str,
    note_text: &str,
) -> Result<PlotMigrationResult, String> {
    if !root.is_dir() {
        return Err("project root does not exist".to_string());
    }
    let _guard = lock_project_config()?;
    let mut config = load_project_config_unlocked(root)?;
    if config.plot_cards.is_empty() {
        return Ok(PlotMigrationResult { status: "empty", note_path: None });
    }
    if config.plot_cards != expected_plot_cards {
        return Err("plot cards changed since they were read".to_string());
    }
    if note_text.trim().is_empty() {
        return Err("note text is empty".to_string());
    }

    let migrated_at = now_millis();
    let backup = write_backup(root, &config.plot_cards, migrated_at)?;
    let (folder, created_folder) = note_folder(root, config.materials_folder_name())?;
    let undo_folder = |created: &Option<String>| {
        if let Some(name) = created {
            let _ = std::fs::remove_dir(root.join(name));
        }
    };
    let (note, wrote_note) = match write_note(&folder, note_name, note_text) {
        Ok(written) => written,
        Err(error) => {
            undo_folder(&created_folder);
            return Err(error);
        }
    };

    let note_path = relative_slash_path(root, &note);
    if let Some(name) = &created_folder {
        config.materials_folder = Some(name.clone());
    }
    config.plot_cards.clear();
    config.plot_migration = Some(PlotMigrationRecord {
        note_path: note_path.clone(),
        backup_path: relative_slash_path(root, &backup),
        migrated_at,
    });
    if let Err(error) = save_project_config_unlocked(root, &config) {
        if wrote_note {
            let _ = std::fs::remove_file(&note);
        }
        undo_folder(&created_folder);
        return Err(error);
    }
    Ok(PlotMigrationResult { status: "migrated", note_path: Some(note_path) })
}

#[tauri::command(async)]
pub(super) fn migrate_project_plot_to_note(
    root_path: String,
    expected_plot_cards: Vec<PlotCardConfig>,
    note_name: String,
    note_text: String,
) -> Result<PlotMigrationResult, String> {
    migrate_plot_to_note(Path::new(&root_path), &expected_plot_cards, &note_name, &note_text)
}

#[cfg(test)]
mod tests;
