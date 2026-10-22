import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReferenceFileInfo } from "../types";
import type { AiConversation, AiConversationSummary, AiMode, AiProviderInfo, AiTurn } from "./types";

/**
 * The conversations of the open work. All AI state lives here, not in App
 * (AI-17). Every request carries the work's folder it was made for; when the
 * work changes the generation moves on, a send in flight is stopped, and any
 * reply that arrives for the earlier work is not applied (AI-16).
 */
export function useAiConversations(rootPath: string | null) {
  const [providers, setProviders] = useState<AiProviderInfo[]>([]);
  const [summaries, setSummaries] = useState<AiConversationSummary[]>([]);
  const [conversation, setConversation] = useState<AiConversation | null>(null);
  const [sendingTurnId, setSendingTurnId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generation = useRef(0);
  const current = useRef<{ rootPath: string | null; conversationId: string | null; sendingTurnId: string | null }>({
    rootPath,
    conversationId: null,
    sendingTurnId: null,
  });

  const refreshList = useCallback(async (root: string, gen: number) => {
    const list = await invoke<AiConversationSummary[]>("ai_list_conversations", { rootPath: root });
    if (gen === generation.current) setSummaries(list);
  }, []);

  useEffect(() => {
    invoke<AiProviderInfo[]>("ai_providers").then(setProviders, (reason) => setError(String(reason)));
  }, []);

  useEffect(() => {
    const previous = current.current;
    if (previous.rootPath && previous.conversationId && previous.sendingTurnId) {
      void invoke("ai_stop_turn", {
        rootPath: previous.rootPath,
        conversationId: previous.conversationId,
        turnId: previous.sendingTurnId,
      }).catch(() => undefined);
    }
    generation.current += 1;
    const gen = generation.current;
    current.current = { rootPath, conversationId: null, sendingTurnId: null };
    setSummaries([]);
    setConversation(null);
    setSendingTurnId(null);
    setError(null);
    if (rootPath) refreshList(rootPath, gen).catch((reason) => setError(String(reason)));
  }, [rootPath, refreshList]);

  /** Runs `task` for the current work and applies its result only if the work is still open. */
  const forWork = useCallback(
    async <T,>(task: (root: string) => Promise<T>, apply: (value: T) => void) => {
      const root = current.current.rootPath;
      if (!root) return;
      const gen = generation.current;
      try {
        const value = await task(root);
        if (gen === generation.current) apply(value);
      } catch (reason) {
        if (gen === generation.current) setError(String(reason));
      }
    },
    [],
  );

  const showConversation = useCallback((next: AiConversation | null) => {
    current.current.conversationId = next?.id ?? null;
    setConversation(next);
  }, []);

  const select = useCallback(
    (id: string | null) => {
      setError(null);
      if (!id) {
        showConversation(null);
        return;
      }
      void forWork(
        (root) => invoke<AiConversation>("ai_load_conversation", { rootPath: root, conversationId: id }),
        showConversation,
      );
    },
    [forWork, showConversation],
  );

  const send = useCallback(
    async (input: string, mode: AiMode): Promise<boolean> => {
      const root = current.current.rootPath;
      if (!root || current.current.sendingTurnId) return false;
      const provider = conversation
        ? providers.find((item) => item.id === conversation.provider)
        : providers[0];
      if (!provider) {
        setError("使える接続先がありません");
        return false;
      }
      const model = conversation?.model ?? provider.models[0];
      const conversationId = conversation?.id ?? crypto.randomUUID();
      const turnId = crypto.randomUUID();
      const gen = generation.current;
      const now = Date.now();
      const pending: AiTurn = {
        id: turnId, input, provider: provider.id, model, mode, promptVersion: 0, status: "sending", createdAt: now, updatedAt: now,
      };
      setError(null);
      current.current.sendingTurnId = turnId;
      current.current.conversationId = conversationId;
      setSendingTurnId(turnId);
      setConversation((shown) =>
        shown && shown.id === conversationId
          ? { ...shown, turns: [...shown.turns, pending] }
          : { id: conversationId, title: input.trim().split("\n")[0].slice(0, 30), provider: provider.id, model, createdAt: now, updatedAt: now, turns: [pending] },
      );
      try {
        const result = await invoke<AiConversation>("ai_send", {
          rootPath: root, conversationId, turnId, input, provider: provider.id, model, mode,
        });
        if (gen !== generation.current) return true;
        if (current.current.conversationId === conversationId) setConversation(result);
        await refreshList(root, gen);
      } catch (reason) {
        if (gen === generation.current) setError(String(reason));
      } finally {
        if (gen === generation.current && current.current.sendingTurnId === turnId) {
          current.current.sendingTurnId = null;
          setSendingTurnId(null);
        }
      }
      return true;
    },
    [conversation, providers, refreshList],
  );

  const stop = useCallback(() => {
    const { conversationId, sendingTurnId: turnId } = current.current;
    if (!conversationId || !turnId) return;
    current.current.sendingTurnId = null;
    setSendingTurnId(null);
    void forWork(
      (root) => invoke<AiConversation>("ai_stop_turn", { rootPath: root, conversationId, turnId }),
      (result) => {
        if (current.current.conversationId === result.id) setConversation(result);
      },
    );
  }, [forWork]);

  const rename = useCallback(
    (title: string) => {
      const id = current.current.conversationId;
      if (!id) return;
      void forWork(
        (root) => invoke<AiConversation>("ai_rename_conversation", { rootPath: root, conversationId: id, title }),
        (result) => {
          showConversation(result);
          setSummaries((list) => list.map((item) => (item.id === result.id ? { ...item, title: result.title } : item)));
        },
      );
    },
    [forWork, showConversation],
  );

  const remove = useCallback(() => {
    const id = current.current.conversationId;
    if (!id || current.current.sendingTurnId) return;
    void forWork(
      (root) => invoke("ai_delete_conversation", { rootPath: root, conversationId: id }),
      () => {
        showConversation(null);
        setSummaries((list) => list.filter((item) => item.id !== id));
      },
    );
  }, [forWork, showConversation]);

  /** Saves (or finds the earlier save of) one answer as a reference file. */
  const saveAnswer = useCallback(
    (turnId: string, onSaved: (file: ReferenceFileInfo) => void) => {
      const id = current.current.conversationId;
      if (!id) return;
      const savedAt = new Date().toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" });
      void forWork(
        async (root) => {
          const file = await invoke<ReferenceFileInfo>("ai_save_answer_as_reference", {
            rootPath: root, conversationId: id, turnId, savedAt,
          });
          const reloaded = await invoke<AiConversation>("ai_load_conversation", { rootPath: root, conversationId: id });
          return { file, reloaded };
        },
        ({ file, reloaded }) => {
          if (current.current.conversationId === reloaded.id) setConversation(reloaded);
          onSaved(file);
        },
      );
    },
    [forWork],
  );

  return {
    providers,
    summaries,
    conversation,
    sendingTurnId,
    error,
    clearError: () => setError(null),
    select,
    send,
    stop,
    rename,
    remove,
    saveAnswer,
  };
}
