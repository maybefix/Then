import { invoke } from "@tauri-apps/api/core";
import type { Dispatch, SetStateAction } from "react";
import type { ProjectFolder, TextTemplateSummary } from "./types";

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

type TemplateActionDeps = {
  projectFolder: ProjectFolder | null;
  currentFileName: string;
  markdown: string;
  setLastError: Dispatch<SetStateAction<string>>;
  showToast: (message: string) => void;
  requestMultiInput: (request: {
    title: string;
    fields: {
      id: string;
      label: string;
      initialValue: string;
      placeholder?: string;
      optional?: boolean;
      multiline?: boolean;
      options?: { value: string; label: string }[];
    }[];
    confirmLabel: string;
  }) => Promise<Record<string, string> | null>;
  requestConfirm: (options: {
    title: string;
    message: string;
    detail?: string;
    confirmLabel: string;
    danger?: boolean;
  }) => Promise<boolean>;
};

/**
 * テンプレートの一覧を読む処理と、開いているファイルをテンプレートとして登録する操作。
 * 値は App が持ち、描画のたびにその時点の値を受け取る。
 */
export function createTemplateActions(deps: TemplateActionDeps) {
  const {
    projectFolder,
    currentFileName,
    markdown,
    setLastError,
    showToast,
    requestMultiInput,
    requestConfirm,
  } = deps;

  const loadTextTemplates = async (): Promise<TextTemplateSummary[]> => {
    if (!isTauriRuntime()) return [];
    return invoke<TextTemplateSummary[]>("list_text_templates", {
      rootPath: projectFolder?.path ?? null,
    });
  };

  const handleRegisterCurrentFileAsTemplate = async () => {
    if (!isTauriRuntime()) {
      showToast("テンプレート登録はTauri版で利用できます");
      return;
    }
    const sourceExtension = currentFileName.toLowerCase().endsWith(".md") ? "md" : "txt";
    const initialName = currentFileName.replace(/\.(?:txt|md)$/i, "") || "新規テンプレート";
    const scopeOptions = projectFolder
      ? [
          { value: "workspace", label: "このワークスペース" },
          { value: "profile", label: "すべてのワークスペースで共通" },
        ]
      : [{ value: "profile", label: "すべてのワークスペースで共通" }];
    const draft = await requestMultiInput({
      title: "このファイルをテンプレートとして登録",
      fields: [
        {
          id: "name",
          label: "テンプレート名",
          initialValue: initialName,
          placeholder: "例: 章のひな型",
        },
        {
          id: "scope",
          label: "保存先",
          initialValue: projectFolder ? "workspace" : "profile",
          options: scopeOptions,
        },
      ],
      confirmLabel: "登録",
    });
    if (!draft) return;

    try {
      const templates = await loadTextTemplates();
      // Rust は前後の空白を削った名前でファイルを作るので、同じ名前を探すときも削っておく。
      const normalizedName = draft.name.trim().replace(/\.(?:txt|md)$/i, "").trim();
      const existing = templates.find(
        (template) =>
          template.scope === draft.scope &&
          template.extension === sourceExtension &&
          template.name.localeCompare(normalizedName, undefined, { sensitivity: "accent" }) === 0,
      );
      let overwrite = false;
      if (existing) {
        overwrite = await requestConfirm({
          title: "テンプレートを上書き",
          message: `「${existing.name}」はすでに登録されています。`,
          detail: "登録済みの内容を、現在のファイル内容で置き換えます。",
          confirmLabel: "上書き",
        });
        if (!overwrite) return;
      }
      const registered = await invoke<TextTemplateSummary>("register_text_template", {
        rootPath: projectFolder?.path ?? null,
        scope: draft.scope,
        name: normalizedName,
        extension: sourceExtension,
        content: markdown,
        overwrite,
      });
      showToast(`テンプレート「${registered.name}」を登録しました`);
    } catch (error) {
      setLastError(String(error));
      showToast("テンプレートを登録できませんでした");
    }
  };

  return { loadTextTemplates, handleRegisterCurrentFileAsTemplate };
}
