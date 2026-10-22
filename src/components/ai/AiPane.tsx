import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { sendErrorMessage, type AiMode, type AiTurn } from "../../ai/types";
import { useAiConversations } from "../../ai/useAiConversations";
import type { AiSettings } from "../../ai/settings";
import type { IdeaThread, ReferenceFileInfo } from "../../types";
import { MarkdownLite } from "../markdown/MarkdownLite";
import "./aiPane.css";

type AiPaneProps = {
  rootPath: string | null;
  settings: AiSettings;
  threads: IdeaThread[];
  /** The answer was saved as a reference file; add it to `threadId`. */
  onReferenceSaved: (threadId: string, file: ReferenceFileInfo) => void;
  onOpenReference: (file: ReferenceFileInfo) => void;
};

const threadLabel = (thread: IdeaThread) => thread.title || (thread.kind === "inbox" ? "インボックス" : "無題のスレッド");

export function AiPane({ rootPath, settings, threads, onReferenceSaved, onOpenReference }: AiPaneProps) {
  const ai = useAiConversations(rootPath, settings);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<AiMode>(settings.defaultMode);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [savingTurnId, setSavingTurnId] = useState<string | null>(null);
  const [saveThreadId, setSaveThreadId] = useState<string>("");
  const turnsRef = useRef<HTMLOListElement>(null);

  const conversation = ai.conversation;
  const provider = conversation
    ? ai.providers.find((item) => item.id === conversation.provider)
    : ai.defaultProvider ?? undefined;
  const canResearch = Boolean(provider?.webResearch);
  const sending = ai.sendingTurnId !== null;
  const lastTurn = conversation?.turns[conversation.turns.length - 1];
  const tooLong = lastTurn?.status === "failed" && lastTurn.error?.code === "inputTooLong";

  useEffect(() => {
    if (!canResearch && mode === "webResearch") setMode("consult");
  }, [canResearch, mode]);

  useEffect(() => {
    setRenaming(null);
    setConfirmingDelete(false);
    setSavingTurnId(null);
  }, [conversation?.id]);

  // Show the newest turn when one is added or answered (inside this pane only).
  const turnCount = conversation?.turns.length ?? 0;
  useEffect(() => {
    const list = turnsRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [turnCount, lastTurn?.status]);

  if (!rootPath) {
    return <section className="aiPane" aria-label="AI"><p className="aiEmpty">作品を開いてください</p></section>;
  }

  const submit = async () => {
    const text = draft;
    if (!text.trim() || sending) return;
    if (await ai.send(text, mode)) setDraft("");
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const startSave = (turnId: string) => {
    setSavingTurnId(turnId);
    setSaveThreadId((current) => (threads.some((thread) => thread.id === current) ? current : threads[0]?.id ?? ""));
  };

  const confirmSave = (turnId: string) => {
    const threadId = saveThreadId;
    ai.saveAnswer(turnId, (file) => {
      setSavingTurnId(null);
      onReferenceSaved(threadId, file);
    });
  };

  const continueInNewConversation = () => {
    if (lastTurn) setDraft(lastTurn.input);
    ai.select(null);
  };

  return (
    <section className="aiPane" aria-label="AI" onKeyDown={(event) => event.stopPropagation()}>
      <div className="aiConversationBar">
        {renaming !== null ? (
          <form
            className="aiRenameForm"
            onSubmit={(event) => {
              event.preventDefault();
              ai.rename(renaming);
              setRenaming(null);
            }}
          >
            <input aria-label="会話の名前" value={renaming} autoFocus onChange={(event) => setRenaming(event.target.value)} />
            <button type="submit">変更</button>
            <button type="button" onClick={() => setRenaming(null)}>やめる</button>
          </form>
        ) : (
          <>
            <select
              aria-label="会話"
              value={conversation?.id ?? ""}
              disabled={sending}
              onChange={(event) => ai.select(event.target.value || null)}
            >
              <option value="">新しい会話</option>
              {conversation && !ai.summaries.some((item) => item.id === conversation.id) && (
                <option value={conversation.id}>{conversation.title}</option>
              )}
              {ai.summaries.map((item) => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
            </select>
            {conversation && !sending && (
              confirmingDelete ? (
                <>
                  <button type="button" className="aiDanger" onClick={() => ai.remove()}>会話を削除する</button>
                  <button type="button" onClick={() => setConfirmingDelete(false)}>やめる</button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setRenaming(conversation.title)}>名前を変更</button>
                  <button type="button" onClick={() => setConfirmingDelete(true)}>削除</button>
                </>
              )
            )}
          </>
        )}
      </div>

      <ol className="aiTurns" ref={turnsRef} aria-label="やりとり">
        {conversation?.turns.map((turn) => (
          <li key={turn.id} className="aiTurn">
            <div className="aiQuestion">{turn.input}</div>
            <TurnAnswer rootPath={rootPath} turn={turn} />
            {turn.id === savingTurnId ? (
              <form
                className="aiTurnActions"
                onSubmit={(event) => {
                  event.preventDefault();
                  confirmSave(turn.id);
                }}
              >
                <select aria-label="保存先のスレッド" value={saveThreadId} onChange={(event) => setSaveThreadId(event.target.value)}>
                  {threads.map((thread) => (
                    <option key={thread.id} value={thread.id}>{threadLabel(thread)}</option>
                  ))}
                </select>
                <button type="submit" disabled={!saveThreadId}>このスレッドに保存</button>
                <button type="button" onClick={() => setSavingTurnId(null)}>やめる</button>
              </form>
            ) : (
              <div className="aiTurnActions">
                {turn.status === "complete" && turn.answer && (
                  turn.savedReferencePath ? (
                    <button type="button" onClick={() => ai.saveAnswer(turn.id, onOpenReference)}>資料を開く</button>
                  ) : (
                    <button type="button" onClick={() => startSave(turn.id)} disabled={!threads.length}>資料に保存</button>
                  )
                )}
                {(turn.status === "failed" || turn.status === "stopped" || turn.status === "interrupted") &&
                  turn.error?.code !== "inputTooLong" && turn === lastTurn && (
                  <button type="button" disabled={sending} onClick={() => void ai.send(turn.input, turn.mode)}>再送</button>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>

      {ai.error && (
        <p className="aiError" role="alert">
          {ai.error}
          <button type="button" onClick={ai.clearError}>閉じる</button>
        </p>
      )}

      <form
        className="aiComposer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          aria-label="AIへの質問"
          value={draft}
          rows={4}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onComposerKeyDown}
        />
        <div className="aiComposerActions">
          <select aria-label="種類" value={mode} onChange={(event) => setMode(event.target.value as AiMode)}>
            <option value="consult">相談</option>
            <option value="webResearch" disabled={!canResearch}>Web検索付き調査</option>
          </select>
          {tooLong && <button type="button" onClick={continueInNewConversation}>新しい会話で続ける</button>}
          {sending ? (
            <button type="button" className="aiPrimary" onClick={ai.stop}>停止</button>
          ) : (
            <button type="submit" className="aiPrimary" disabled={!draft.trim() || !provider}>
              {provider ? "送信" : "接続先がありません"}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function TurnAnswer({ rootPath, turn }: { rootPath: string; turn: AiTurn }) {
  if (turn.status === "sending") return <p className="aiStatus" role="status">回答を待っています…</p>;
  if (turn.status === "stopped") return <p className="aiStatus">停止しました</p>;
  if (turn.status === "interrupted") return <p className="aiStatus">Thenが閉じられたため中断しました</p>;
  if (turn.status === "failed") {
    return <p className="aiStatus aiFailed">{turn.error ? sendErrorMessage(turn.error) : "送信できませんでした"}</p>;
  }
  if (turn.ending === "refused") return <p className="aiStatus aiFailed">回答を断られました</p>;
  return (
    <div className="aiAnswer">
      <MarkdownLite rootPath={rootPath} sourcePath="" scope="project" text={turn.answer ?? ""} />
      {turn.citations && turn.citations.length > 0 && (
        <ol className="aiCitations" aria-label="出典">
          {turn.citations.map((citation, index) => (
            <li key={index}>
              <MarkdownLite rootPath={rootPath} sourcePath="" scope="project" text={`[${citation.title}](${citation.url})`} />
            </li>
          ))}
        </ol>
      )}
      {(turn.ending === "truncated" || (turn.mode === "webResearch" && turn.searched === false)) && (
        <p className="aiStatus">
          {turn.ending === "truncated" ? "出力の上限で途中まで" : ""}
          {turn.ending === "truncated" && turn.mode === "webResearch" && turn.searched === false ? "・" : ""}
          {turn.mode === "webResearch" && turn.searched === false ? "検索は行われませんでした" : ""}
        </p>
      )}
    </div>
  );
}
