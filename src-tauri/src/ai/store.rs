//! Conversations kept in a work (plan 4.1, 4.2).
//!
//! `<work>/.then/ai/index.json` lists the conversations; each one lives in
//! `<work>/.then/ai/conversations/<id>.json`, so a new turn rewrites only its
//! own conversation. File names come from ids checked here, never from text
//! the page or a model supplied (AI-15). Every write replaces the whole file
//! at once; the index also keeps the previous good copy beside it.

use super::conversation::{Answer, Citation, Ending, Mode, Provider, SendError, Usage};
use crate::atomic_file::write_replacing;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TurnStatus {
    Sending,
    Complete,
    Failed,
    /// The user stopped it; a reply arriving later is dropped.
    Stopped,
    /// Then closed (or crashed) while it was being sent. Nothing is resent.
    Interrupted,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredTurn {
    pub id: String,
    pub input: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub citations: Vec<Citation>,
    pub provider: Provider,
    pub model: String,
    pub mode: Mode,
    pub prompt_version: u32,
    pub status: TurnStatus,
    /// The run that sent it; a `Sending` turn from another run was cut off.
    pub run: String,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub searched: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ending: Option<Ending>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<Usage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<SendError>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saved_reference_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub schema_version: u32,
    pub id: String,
    pub title: String,
    pub provider: Provider,
    pub model: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub turns: Vec<StoredTurn>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    pub title: String,
    pub provider: Provider,
    pub model: String,
    pub updated_at: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Index {
    schema_version: u32,
    conversations: Vec<Summary>,
}

/// Reads and writes of one work's conversations, one at a time across the
/// app: a send appends a turn, then later fills it in, and the two must not
/// interleave with a rename or a stop.
pub fn lock() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(())).lock().unwrap_or_else(|e| e.into_inner())
}

/// This process. A turn left `Sending` by another run was cut off.
pub fn run_id() -> &'static str {
    static RUN: OnceLock<String> = OnceLock::new();
    RUN.get_or_init(|| format!("{}-{}", std::process::id(), now()))
}

pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// Ids name files, so only short lowercase letters, digits and hyphens pass.
pub fn check_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if ok { Ok(()) } else { Err("会話の識別子が正しくありません".to_string()) }
}

fn ai_dir(root: &Path) -> PathBuf {
    root.join(".then").join("ai")
}

fn index_path(root: &Path) -> PathBuf {
    ai_dir(root).join("index.json")
}

fn conversation_path(root: &Path, id: &str) -> PathBuf {
    ai_dir(root).join("conversations").join(format!("{id}.json"))
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("AIの会話を保存できませんでした: {error}"))?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    write_replacing(path, text).map_err(|error| format!("AIの会話を保存できませんでした: {error}"))
}

fn read_index(root: &Path) -> Index {
    let path = index_path(root);
    let read = |path: &Path| -> Option<Index> { serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok() };
    read(&path)
        .or_else(|| read(&path.with_extension("json.bak")))
        .unwrap_or_default()
}

fn write_index(root: &Path, index: &Index) -> Result<(), String> {
    let path = index_path(root);
    if path.is_file() {
        let _ = std::fs::copy(&path, path.with_extension("json.bak"));
    }
    write_json(&path, index)
}

fn summary(conversation: &Conversation) -> Summary {
    Summary {
        id: conversation.id.clone(),
        title: conversation.title.clone(),
        provider: conversation.provider,
        model: conversation.model.clone(),
        updated_at: conversation.updated_at,
    }
}

/// Newest first.
pub fn list(root: &Path) -> Vec<Summary> {
    let mut conversations = read_index(root).conversations;
    conversations.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    conversations
}

/// A turn another run left `Sending` reads as `Interrupted`, and is saved so.
pub fn load(root: &Path, id: &str) -> Result<Conversation, String> {
    check_id(id)?;
    let text = std::fs::read_to_string(conversation_path(root, id))
        .map_err(|_| "会話が見つかりません".to_string())?;
    let mut conversation: Conversation =
        serde_json::from_str(&text).map_err(|_| "会話を読み込めませんでした".to_string())?;
    let mut changed = false;
    for turn in &mut conversation.turns {
        if turn.status == TurnStatus::Sending && turn.run != run_id() {
            turn.status = TurnStatus::Interrupted;
            changed = true;
        }
    }
    if changed {
        save(root, &conversation)?;
    }
    Ok(conversation)
}

pub fn save(root: &Path, conversation: &Conversation) -> Result<(), String> {
    check_id(&conversation.id)?;
    write_json(&conversation_path(root, &conversation.id), conversation)?;
    let mut index = read_index(root);
    index.schema_version = SCHEMA_VERSION;
    index.conversations.retain(|item| item.id != conversation.id);
    index.conversations.push(summary(conversation));
    write_index(root, &index)
}

pub fn delete(root: &Path, id: &str) -> Result<(), String> {
    check_id(id)?;
    let mut index = read_index(root);
    index.conversations.retain(|item| item.id != id);
    write_index(root, &index)?;
    match std::fs::remove_file(conversation_path(root, id)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("会話を削除できませんでした: {error}")),
    }
}

pub fn title_from(input: &str) -> String {
    let line = input.lines().map(str::trim).find(|line| !line.is_empty()).unwrap_or("新しい会話");
    let mut title: String = line.chars().take(30).collect();
    if line.chars().count() > 30 {
        title.push('…');
    }
    title
}

/// Fills in a turn that was being sent. A turn the user stopped, or one no
/// longer there, keeps its state: the late reply is dropped.
pub fn finish_turn(conversation: &mut Conversation, turn_id: &str, result: Result<Answer, SendError>) -> bool {
    let Some(turn) = conversation.turns.iter_mut().find(|turn| turn.id == turn_id) else {
        return false;
    };
    if turn.status != TurnStatus::Sending {
        return false;
    }
    match result {
        Ok(answer) => {
            turn.status = TurnStatus::Complete;
            turn.answer = Some(answer.text);
            turn.citations = answer.citations;
            turn.searched = answer.searched;
            turn.usage = Some(answer.usage);
            turn.ending = Some(answer.ending);
            turn.native = answer.native;
        }
        Err(error) => {
            turn.status = TurnStatus::Failed;
            turn.error = Some(error);
        }
    }
    turn.updated_at = now();
    conversation.updated_at = turn.updated_at;
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("then-ai-store-{name}-{}-{}", std::process::id(), now()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn conversation(id: &str, updated_at: u64) -> Conversation {
        Conversation {
            schema_version: SCHEMA_VERSION,
            id: id.into(),
            title: "t".into(),
            provider: Provider::Fixture,
            model: "fixture".into(),
            created_at: 1,
            updated_at,
            turns: vec![],
        }
    }

    fn turn(id: &str, status: TurnStatus, run: &str) -> StoredTurn {
        StoredTurn {
            id: id.into(),
            input: "q".into(),
            answer: None,
            citations: vec![],
            provider: Provider::Fixture,
            model: "fixture".into(),
            mode: Mode::Consult,
            prompt_version: 2,
            status,
            run: run.into(),
            created_at: 1,
            updated_at: 1,
            searched: None,
            ending: None,
            usage: None,
            error: None,
            native: None,
            saved_reference_path: None,
        }
    }

    #[test]
    fn ids_that_could_leave_the_folder_are_refused() {
        for id in ["", "../x", "a/b", "A", "a.b", "a b", &"a".repeat(65), "c:"] {
            assert!(check_id(id).is_err(), "{id:?}");
        }
        assert!(check_id("0f8e-4c21-a").is_ok());
    }

    #[test]
    fn saves_each_conversation_in_its_own_file_and_lists_newest_first() {
        let root = temp_root("list");
        save(&root, &conversation("old", 10)).unwrap();
        save(&root, &conversation("new", 20)).unwrap();
        assert!(root.join(".then/ai/conversations/old.json").is_file());
        assert_eq!(list(&root).iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["new", "old"]);
        delete(&root, "old").unwrap();
        assert!(!root.join(".then/ai/conversations/old.json").exists());
        assert_eq!(list(&root).len(), 1);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_broken_index_falls_back_to_the_previous_copy() {
        let root = temp_root("bak");
        save(&root, &conversation("a", 1)).unwrap();
        save(&root, &conversation("b", 2)).unwrap();
        std::fs::write(index_path(&root), "{ broken").unwrap();
        assert_eq!(list(&root).iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["a"]);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_turn_left_sending_by_another_run_reads_as_interrupted() {
        let root = temp_root("interrupted");
        let mut c = conversation("c", 1);
        c.turns.push(turn("old", TurnStatus::Sending, "earlier-run"));
        c.turns.push(turn("mine", TurnStatus::Sending, run_id()));
        save(&root, &c).unwrap();
        let loaded = load(&root, "c").unwrap();
        assert_eq!(loaded.turns[0].status, TurnStatus::Interrupted);
        assert_eq!(loaded.turns[1].status, TurnStatus::Sending);
        // And it stays so on disk.
        let raw = std::fs::read_to_string(conversation_path(&root, "c")).unwrap();
        assert!(raw.contains("\"interrupted\""));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_late_reply_to_a_stopped_turn_is_dropped() {
        let mut c = conversation("c", 1);
        c.turns.push(turn("t", TurnStatus::Stopped, run_id()));
        let answer = Answer {
            text: "a".into(),
            citations: vec![],
            searched: None,
            usage: Usage::default(),
            ending: Ending::Complete,
            native: None,
        };
        assert!(!finish_turn(&mut c, "t", Ok(answer.clone())));
        assert_eq!(c.turns[0].status, TurnStatus::Stopped);
        assert_eq!(c.turns[0].answer, None);
        c.turns[0].status = TurnStatus::Sending;
        assert!(finish_turn(&mut c, "t", Ok(answer)));
        assert_eq!(c.turns[0].status, TurnStatus::Complete);
        assert!(!finish_turn(&mut c, "missing", Err(SendError::Network)));
    }

    #[test]
    fn titles_come_from_the_first_line_of_the_question() {
        assert_eq!(title_from("\n  主人公の年齢は？\n二行目"), "主人公の年齢は？");
        assert_eq!(title_from(&"あ".repeat(40)), format!("{}…", "あ".repeat(30)));
        assert_eq!(title_from("   "), "新しい会話");
    }
}
