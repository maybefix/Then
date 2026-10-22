import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { AI_PROVIDERS_CHANGED } from "../../ai/settings";
import type { AiMode, AiProvider, AiProviderInfo } from "../../ai/types";
import type { SettingsPanelProps } from "./SettingsPanelTypes";
import "./aiSettings.css";

/**
 * Providers, models and API keys for the AI pane. A key typed here goes
 * straight to the Credential Manager through Rust; the field is cleared after
 * saving and is never filled from a stored key.
 */
export function AiSettings({ settings, onUpdateSettings }: SettingsPanelProps) {
  const ai = settings.ai;
  const [providers, setProviders] = useState<AiProviderInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    invoke<AiProviderInfo[]>("ai_providers").then(setProviders, (reason) => setError(String(reason)));
  }, []);
  useEffect(reload, [reload]);

  const keysChanged = () => {
    reload();
    window.dispatchEvent(new Event(AI_PROVIDERS_CHANGED));
  };

  const setModel = (provider: AiProvider, model: string) => {
    const models = { ...ai.models };
    if (model.trim()) models[provider] = model.trim();
    else delete models[provider];
    onUpdateSettings("ai", { ...ai, models });
  };

  return (
    <>
      <label>
        <span>新しい会話の接続先</span>
        <select
          value={ai.provider ?? ""}
          onChange={(event) =>
            onUpdateSettings("ai", { ...ai, provider: (event.target.value || null) as AiProvider | null })
          }
        >
          <option value="">自動</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
              {provider.available ? "" : "（未接続）"}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>新しい会話の種類</span>
        <select
          value={ai.defaultMode}
          onChange={(event) => onUpdateSettings("ai", { ...ai, defaultMode: event.target.value as AiMode })}
        >
          <option value="consult">相談</option>
          <option value="webResearch">Web検索付き調査</option>
        </select>
      </label>
      {error && <p className="aiSettingsError" role="alert">{error}</p>}
      {providers
        .filter((provider) => provider.id !== "fixture")
        .map((provider) => (
          <fieldset key={provider.id} className="aiProviderSettings">
            <legend>{provider.label}</legend>
            {provider.needsKey && <KeyField provider={provider} onChanged={keysChanged} />}
            {provider.id === "local" && (
              <label>
                <span>アドレス</span>
                <input
                  value={ai.localEndpoint}
                  spellCheck={false}
                  placeholder="http://localhost:11434"
                  onChange={(event) => onUpdateSettings("ai", { ...ai, localEndpoint: event.target.value })}
                />
              </label>
            )}
            <label>
              <span>モデル</span>
              <input
                list={`ai-models-${provider.id}`}
                value={ai.models[provider.id] ?? ""}
                spellCheck={false}
                placeholder={provider.models[0] ?? "モデル名"}
                onChange={(event) => setModel(provider.id, event.target.value)}
              />
              <datalist id={`ai-models-${provider.id}`}>
                {provider.models.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </label>
          </fieldset>
        ))}
    </>
  );
}

function KeyField({ provider, onChanged }: { provider: AiProviderInfo; onChanged: () => void }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (task: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await task();
      setDraft("");
      setMessage(done);
      onChanged();
    } catch (reason) {
      setMessage(String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="aiKeyField">
      <span className="aiKeyLabel">
        APIキー<span className={provider.keySaved ? "aiKeySaved" : "aiKeyMissing"}>{provider.keySaved ? "保存済み" : "未保存"}</span>
      </span>
      <form
        className="aiKeyRow"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => invoke("ai_store_key", { provider: provider.id, key: draft }), "保存しました");
        }}
      >
        <input
          type="password"
          aria-label={`${provider.label}のAPIキー`}
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={busy || !draft.trim()}>
          {provider.keySaved ? "差し替える" : "保存"}
        </button>
        {provider.keySaved && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => invoke("ai_delete_key", { provider: provider.id }), "削除しました")}
          >
            削除
          </button>
        )}
      </form>
      {message && <span className="aiKeyMessage" role="status">{message}</span>}
    </div>
  );
}
