//! The commands the conversation pane calls.
//!
//! A send is recorded before anything leaves the machine and finished after
//! the reply comes back, with the store unlocked in between, so a stop or
//! another conversation is never held up by a slow provider. Each command
//! gets the work's folder and the ids; where things are written is decided
//! here (AI-15).

use super::conversation::{check, Mode, Provider, Request, SendError, Turn};
use super::store::{self, Conversation, StoredTurn, Summary, TurnStatus};
use super::{fixture, markdown, prompt};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderInfo {
    id: Provider,
    label: &'static str,
    models: Vec<&'static str>,
    web_research: bool,
}

pub fn provider_label(provider: Provider) -> &'static str {
    match provider {
        Provider::Gemini => "Gemini",
        Provider::OpenAi => "OpenAI",
        Provider::Claude => "Claude",
        Provider::Local => "ローカルLLM",
        Provider::Fixture => "固定応答",
    }
}

/// The fixture shows in development builds, or in a QA build started with
/// THEN_AI_FIXTURE=1. Real providers join as they are wired in.
fn fixture_enabled() -> bool {
    cfg!(debug_assertions) || std::env::var("THEN_AI_FIXTURE").as_deref() == Ok("1")
}

#[tauri::command(async)]
pub(crate) fn ai_providers() -> Vec<ProviderInfo> {
    let mut providers = Vec::new();
    if fixture_enabled() {
        providers.push(ProviderInfo {
            id: Provider::Fixture,
            label: provider_label(Provider::Fixture),
            models: vec![fixture::MODEL],
            web_research: super::conversation::capabilities(Provider::Fixture).web_research,
        });
    }
    providers
}

/// The work's folder, checked to be a work Then manages.
fn work_root(root_path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(root_path);
    if !crate::library::is_project_root(&root) {
        return Err("作品のフォルダが見つかりません".to_string());
    }
    root.canonicalize().map_err(|_| "作品のフォルダが見つかりません".to_string())
}

#[tauri::command(async)]
pub(crate) fn ai_list_conversations(root_path: String) -> Result<Vec<Summary>, String> {
    let root = work_root(&root_path)?;
    let _one = store::lock();
    Ok(store::list(&root))
}

#[tauri::command(async)]
pub(crate) fn ai_load_conversation(root_path: String, conversation_id: String) -> Result<Conversation, String> {
    let root = work_root(&root_path)?;
    let _one = store::lock();
    store::load(&root, &conversation_id)
}

#[tauri::command(async)]
pub(crate) fn ai_rename_conversation(root_path: String, conversation_id: String, title: String) -> Result<Conversation, String> {
    let root = work_root(&root_path)?;
    let title: String = title.trim().chars().filter(|c| !c.is_control()).take(80).collect();
    if title.is_empty() {
        return Err("名前を入力してください".to_string());
    }
    let _one = store::lock();
    let mut conversation = store::load(&root, &conversation_id)?;
    conversation.title = title;
    store::save(&root, &conversation)?;
    Ok(conversation)
}

#[tauri::command(async)]
pub(crate) fn ai_delete_conversation(root_path: String, conversation_id: String) -> Result<(), String> {
    let root = work_root(&root_path)?;
    let _one = store::lock();
    store::delete(&root, &conversation_id)
}

/// Stops a turn being sent. Whatever the provider still sends back is dropped
/// (and may still be billed: stopping is local).
#[tauri::command(async)]
pub(crate) fn ai_stop_turn(root_path: String, conversation_id: String, turn_id: String) -> Result<Conversation, String> {
    let root = work_root(&root_path)?;
    let _one = store::lock();
    let mut conversation = store::load(&root, &conversation_id)?;
    if let Some(turn) = conversation.turns.iter_mut().find(|turn| turn.id == turn_id) {
        if turn.status == TurnStatus::Sending {
            turn.status = TurnStatus::Stopped;
            turn.updated_at = store::now();
            store::save(&root, &conversation)?;
        }
    }
    Ok(conversation)
}

/// Records the question as a turn, then sends. The page makes `turn_id` when
/// the user presses send, so a second press with the same id is refused
/// instead of being paid for twice (AI-18).
#[tauri::command]
pub(crate) async fn ai_send(
    root_path: String,
    conversation_id: String,
    turn_id: String,
    input: String,
    provider: Provider,
    model: String,
    mode: Mode,
) -> Result<Conversation, String> {
    let root = work_root(&root_path)?;
    store::check_id(&turn_id)?;
    let request = {
        let _one = store::lock();
        let mut conversation = match store::load(&root, &conversation_id) {
            Ok(conversation) => conversation,
            Err(_) => {
                store::check_id(&conversation_id)?;
                let at = store::now();
                Conversation {
                    schema_version: store::SCHEMA_VERSION,
                    id: conversation_id.clone(),
                    title: store::title_from(&input),
                    provider,
                    model: model.clone(),
                    created_at: at,
                    updated_at: at,
                    turns: vec![],
                }
            }
        };
        if conversation.turns.iter().any(|turn| turn.id == turn_id) {
            return Err("この質問はもう送っています".to_string());
        }
        let history = conversation
            .turns
            .iter()
            .filter(|turn| turn.status == TurnStatus::Complete)
            .filter_map(|turn| {
                Some(Turn { input: turn.input.clone(), answer: turn.answer.clone()?, native: turn.native.clone() })
            })
            .collect();
        // A conversation keeps the provider and model it started with.
        let request = Request {
            provider: conversation.provider,
            model: conversation.model.clone(),
            mode,
            history,
            input: input.clone(),
        };
        let at = store::now();
        let checked = check(&request);
        conversation.turns.push(StoredTurn {
            id: turn_id.clone(),
            input,
            answer: None,
            citations: vec![],
            provider: request.provider,
            model: request.model.clone(),
            mode,
            prompt_version: prompt::PROMPT_VERSION,
            status: if checked.is_ok() { TurnStatus::Sending } else { TurnStatus::Failed },
            run: store::run_id().to_string(),
            created_at: at,
            updated_at: at,
            searched: None,
            ending: None,
            usage: None,
            error: checked.clone().err(),
            native: None,
            saved_reference_path: None,
        });
        conversation.updated_at = at;
        store::save(&root, &conversation)?;
        if checked.is_err() {
            return Ok(conversation);
        }
        request
    };

    let result = tauri::async_runtime::spawn_blocking(move || send_blocking(&request))
        .await
        .unwrap_or(Err(SendError::BadResponse))
        .map(|mut answer| {
            let tidied = markdown::tidy_answer(&answer.text);
            if tidied != answer.text {
                // Positions were counted in the untidied text.
                for citation in &mut answer.citations {
                    citation.start = None;
                    citation.end = None;
                }
                answer.text = tidied;
            }
            answer
        });

    let _one = store::lock();
    let mut conversation = store::load(&root, &conversation_id)?;
    if store::finish_turn(&mut conversation, &turn_id, result) {
        store::save(&root, &conversation)?;
    }
    Ok(conversation)
}

fn send_blocking(request: &Request) -> Result<super::conversation::Answer, SendError> {
    match request.provider {
        Provider::Fixture if fixture_enabled() => fixture::send(request),
        _ => Err(SendError::KeyMissing),
    }
}

/// The answer as a Markdown reference in the work, made when the user asks
/// and only then. Saving the same answer again returns the file made before.
#[tauri::command(async)]
pub(crate) fn ai_save_answer_as_reference(
    root_path: String,
    conversation_id: String,
    turn_id: String,
    saved_at: String,
) -> Result<crate::ReferenceFileInfo, String> {
    let root = work_root(&root_path)?;
    let _one = store::lock();
    let mut conversation = store::load(&root, &conversation_id)?;
    let index = conversation
        .turns
        .iter()
        .position(|turn| turn.id == turn_id)
        .ok_or_else(|| "回答が見つかりません".to_string())?;
    if let Some(saved) = &conversation.turns[index].saved_reference_path {
        let path = root.join(saved);
        if path.is_file() {
            return crate::reference_file_info(&root, &path, "project");
        }
    }
    let turn = &conversation.turns[index];
    let answer = match (&turn.status, &turn.answer) {
        (TurnStatus::Complete, Some(answer)) => answer.clone(),
        _ => return Err("保存できる回答がありません".to_string()),
    };
    let saved_at: String = saved_at.chars().filter(|c| !c.is_control()).take(40).collect();
    let content = reference_markdown(&conversation.title, turn, &answer, &saved_at);

    let imports = crate::reference_imports_dir(&root);
    std::fs::create_dir_all(&imports).map_err(|error| format!("資料を保存できませんでした: {error}"))?;
    let number = conversation.turns[..=index].iter().filter(|turn| turn.status == TurnStatus::Complete).count();
    let name = format!("AI_{}_{number}.md", file_stem(&conversation.title));
    let path = crate::unique_reference_import_path(&imports, &name);
    crate::atomic_file::write_replacing(&path, content).map_err(|error| format!("資料を保存できませんでした: {error}"))?;

    let info = crate::reference_file_info(&root, &path, "project")?;
    conversation.turns[index].saved_reference_path = Some(info.source_path.clone());
    store::save(&root, &conversation)?;
    Ok(info)
}

/// Characters Windows refuses in a file name are dropped; the title is cut short.
fn file_stem(title: &str) -> String {
    let stem: String = title
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '…'))
        .take(40)
        .collect();
    let stem = stem.trim().trim_end_matches('.').to_string();
    if stem.is_empty() { "回答".to_string() } else { stem }
}

/// The saved reference: the question, the answer as it came, the sources
/// below it, and what produced it.
fn reference_markdown(title: &str, turn: &StoredTurn, answer: &str, saved_at: &str) -> String {
    let mut out = format!("# {title}\n\n## 質問\n\n{}\n\n## 回答\n\n{}\n", turn.input.trim(), answer.trim());
    if !turn.citations.is_empty() {
        out.push_str("\n## 出典\n\n");
        for (number, citation) in turn.citations.iter().enumerate() {
            out.push_str(&format!("{}. [{}]({})\n", number + 1, citation.title, citation.url));
        }
    }
    let mode = match (turn.mode, turn.searched) {
        (Mode::Consult, _) => "相談（Webは検索していない）",
        (Mode::WebResearch, Some(true)) => "Web検索付き調査",
        (Mode::WebResearch, _) => "Web検索付き調査（検索は行われなかった）",
    };
    out.push_str(&format!(
        "\n---\n\n- 保存日時: {saved_at}\n- 接続先: {} / {}\n- 種類: {mode}\n",
        provider_label(turn.provider),
        turn.model
    ));
    if turn.ending == Some(super::conversation::Ending::Truncated) {
        out.push_str("- 出力の上限で途中まで\n");
    }
    out
}

/// Kept for tests that build a work folder by hand.
#[cfg(test)]
pub(crate) fn make_work(dir: &std::path::Path) {
    std::fs::create_dir_all(dir.join(".then")).unwrap();
    std::fs::write(dir.join(".then").join("project.json"), "{}").unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn work(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("then-ai-cmd-{name}-{}-{}", std::process::id(), store::now()));
        make_work(&dir);
        dir
    }

    fn send(root: &Path, conversation: &str, turn: &str, input: &str) -> Result<Conversation, String> {
        tauri::async_runtime::block_on(ai_send(
            root.to_string_lossy().into(),
            conversation.into(),
            turn.into(),
            input.into(),
            Provider::Fixture,
            fixture::MODEL.into(),
            Mode::Consult,
        ))
    }

    #[test]
    fn a_folder_that_is_not_a_work_is_refused() {
        let dir = std::env::temp_dir().join(format!("then-ai-cmd-notwork-{}", store::now()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(ai_list_conversations(dir.to_string_lossy().into()).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn turns_go_on_with_the_earlier_ones_and_a_repeated_turn_id_is_refused() {
        let root = work("turns");
        let first = send(&root, "c1", "t1", "一つ目").unwrap();
        assert_eq!(first.title, "一つ目");
        assert_eq!(first.turns[0].status, TurnStatus::Complete);
        assert!(first.turns[0].answer.as_ref().unwrap().contains("これまでの往復: 0件"));
        let second = send(&root, "c1", "t2", "二つ目").unwrap();
        assert!(second.turns[1].answer.as_ref().unwrap().contains("これまでの往復: 1件"));
        assert_eq!(send(&root, "c1", "t2", "二つ目").unwrap_err(), "この質問はもう送っています");
        assert_eq!(store::load(&root, "c1").unwrap().turns.len(), 2);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn failures_are_kept_as_failed_turns_and_left_out_of_later_history() {
        let root = work("failed");
        let failed = send(&root, "c1", "t1", "[fixture:auth]").unwrap();
        assert_eq!(failed.turns[0].status, TurnStatus::Failed);
        assert_eq!(failed.turns[0].error, Some(SendError::Auth));
        let too_long = send(&root, "c1", "t2", &"字".repeat(super::super::conversation::INPUT_CHAR_LIMIT + 1)).unwrap();
        assert!(matches!(too_long.turns[1].error, Some(SendError::InputTooLong { .. })));
        let ok = send(&root, "c1", "t3", "次").unwrap();
        assert!(ok.turns[2].answer.as_ref().unwrap().contains("これまでの往復: 0件"));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn answers_are_tidied_before_they_are_kept() {
        let root = work("tidy");
        let c = send(&root, "c1", "t1", "[fixture:unsafe]").unwrap();
        let answer = c.turns[0].answer.as_ref().unwrap();
        assert!(!answer.contains("javascript:"));
        assert!(!answer.contains("!["));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn saving_an_answer_makes_one_reference_and_saving_again_returns_it() {
        let root = work("save");
        send(&root, "c1", "t1", "主人公の年齢は？").unwrap();
        let at = || "2026/10/22 15:00".to_string();
        let first = ai_save_answer_as_reference(root.to_string_lossy().into(), "c1".into(), "t1".into(), at()).unwrap();
        assert_eq!(first.name, "AI_主人公の年齢は？_1.md");
        let again = ai_save_answer_as_reference(root.to_string_lossy().into(), "c1".into(), "t1".into(), at()).unwrap();
        assert_eq!(again.source_path, first.source_path);
        let files = std::fs::read_dir(crate::reference_imports_dir(&root)).unwrap().count();
        assert_eq!(files, 1);
        let text = std::fs::read_to_string(root.join(&first.source_path)).unwrap();
        assert!(text.starts_with("# 主人公の年齢は？\n\n## 質問\n\n主人公の年齢は？"));
        assert!(text.contains("- 保存日時: 2026/10/22 15:00"));
        assert!(text.contains("- 接続先: 固定応答 / fixture"));
        assert!(text.contains("相談（Webは検索していない）"));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_failed_turn_cannot_be_saved() {
        let root = work("savefail");
        send(&root, "c1", "t1", "[fixture:network]").unwrap();
        assert!(ai_save_answer_as_reference(root.to_string_lossy().into(), "c1".into(), "t1".into(), String::new()).is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn file_names_drop_what_windows_refuses() {
        assert_eq!(file_stem("a/b:c*?\"<>|d…"), "abcd");
        assert_eq!(file_stem("..."), "回答");
    }
}
