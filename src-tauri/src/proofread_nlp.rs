use serde_json::Value;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

static BUSY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
struct BusyGuard;
impl Drop for BusyGuard {
    fn drop(&mut self) {
        BUSY.store(false, std::sync::atomic::Ordering::Release);
    }
}

#[tauri::command]
pub async fn analyze_proofread_nlp(text: String, mode: String) -> Result<Value, String> {
    if text.encode_utf16().count() > 12000 || !matches!(mode.as_str(), "morphology" | "dependency")
    {
        return Err("解析モードまたは文字数が範囲外です（最大12,000文字）。".into());
    }
    if BUSY
        .compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::AcqRel,
            std::sync::atomic::Ordering::Relaxed,
        )
        .is_err()
    {
        return Err("別の文脈解析が実行中です。完了後に再実行してください。".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = BusyGuard;
        let python = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.venv-nlp/Scripts/python.exe");
        if !python.is_file() {
            return Err("文脈解析用の環境が未導入です。開発用セットアップ（docs/PROOFREAD_CONTEXT_ANALYSIS.md）を実行してください。".into());
        }
        let mut command = Command::new(python);
        command.args(["-I", "-c", include_str!("../../scripts/nlp/analyze.py")])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().map_err(|e| format!("解析器を起動できません: {e}"))?;
        let stdout = child.stdout.take().ok_or("解析器の出力を取得できません")?;
        let stderr = child.stderr.take().ok_or("解析器のエラー出力を取得できません")?;
        // Drain concurrently so a large token response cannot fill the pipe and deadlock.
        let out = std::thread::spawn(move || { let mut buf = Vec::new(); stdout.take(8_000_000).read_to_end(&mut buf).map(|_| buf) });
        let err = std::thread::spawn(move || { let mut buf = Vec::new(); stderr.take(64_000).read_to_end(&mut buf).map(|_| buf) });
        let payload = serde_json::to_vec(&serde_json::json!({"text": text, "mode": mode})).map_err(|e| e.to_string())?;
        let write_result = child.stdin.take().ok_or("解析器へ入力できません")?.write_all(&payload);
        if write_result.is_err() { let _ = child.kill(); let _ = child.wait(); return Err("解析器への入力に失敗しました。".into()); }
        let start = Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if start.elapsed() < Duration::from_secs(90) => std::thread::sleep(Duration::from_millis(30)),
                _ => { let _ = child.kill(); let _ = child.wait(); return Err("文脈解析が時間内に完了しませんでした。".into()); }
            }
        };
        let output = out.join().map_err(|_| "解析出力の読取に失敗")?.map_err(|e| e.to_string())?;
        let error = err.join().map_err(|_| "解析エラーの読取に失敗")?.map_err(|e| e.to_string())?;
        if !status.success() {
            // Do not echo stderr: Python exceptions may contain manuscript content.
            let missing = String::from_utf8_lossy(&error).contains("ModuleNotFoundError");
            return Err(if missing { "解析ライブラリが未導入です。開発用セットアップを実行してください。" } else { "解析器でエラーが発生しました。解析環境とモデルの導入を確認してください。" }.into());
        }
        serde_json::from_slice(&output).map_err(|_| "解析結果を読み取れませんでした。".into())
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_requests() {
        assert!(tauri::async_runtime::block_on(analyze_proofread_nlp(
            "本文".into(),
            "unknown".into()
        ))
        .is_err());
        assert!(tauri::async_runtime::block_on(analyze_proofread_nlp(
            "あ".repeat(12001),
            "dependency".into()
        ))
        .is_err());
    }

    #[test]
    #[ignore = "requires the local NLP environment; run explicitly after setup"]
    fn real_python_bridge() {
        let text = "😀期待に十分答える。";
        let value =
            tauri::async_runtime::block_on(analyze_proofread_nlp(text.into(), "dependency".into()))
                .unwrap();
        let tokens = value["tokens"].as_array().unwrap();
        assert!(tokens
            .iter()
            .any(|t| t["surface"] == "期待" && t["start"] == 2));
        assert!(value["morphology"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["lemma"] == "答える"));
        assert!(!BUSY.load(std::sync::atomic::Ordering::Acquire));
    }
}
