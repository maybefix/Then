import { type FormEvent, useState } from "react";
import type { AppDialog, TextTemplateSummary } from "../../types";

// アプリ内ダイアログ（入力・確認・二択・選択肢・新規ファイル）。今出ているダイアログを1つ持ち、
// request* は答えを Promise で返す。画面（AppDialogModal）からの操作で答えを渡して閉じる。
export function useAppDialog() {
  const [appDialog, setAppDialog] = useState<AppDialog | null>(null);

  const requestInput = ({
    title,
    label,
    initialValue,
    confirmLabel,
    placeholder,
    optional = false,
  }: {
    title: string;
    label: string;
    initialValue: string;
    confirmLabel: string;
    placeholder?: string;
    optional?: boolean;
  }) =>
    new Promise<string | null>((resolve) => {
      setAppDialog({
        type: "input",
        title,
        label,
        value: initialValue,
        confirmLabel,
        placeholder,
        optional,
        error: "",
        resolve,
      });
    });

  const requestMultiInput = ({
    title,
    fields,
    confirmLabel,
  }: {
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
  }) =>
    new Promise<Record<string, string> | null>((resolve) => {
      setAppDialog({
        type: "multiInput",
        title,
        fields: fields.map((field) => ({
          id: field.id,
          label: field.label,
          value: field.initialValue,
          placeholder: field.placeholder,
          optional: field.optional,
          multiline: field.multiline,
          options: field.options,
        })),
        confirmLabel,
        error: "",
        resolve,
      });
    });

  const requestCreateFile = (templates: TextTemplateSummary[]) =>
    new Promise<{ fileName: string; templateId: string | null } | null>((resolve) => {
      setAppDialog({
        type: "createFile",
        title: "新規ファイルを作成",
        fileName: "新規ノート",
        extension: "txt",
        templateId: "",
        templates,
        confirmLabel: "作成",
        error: "",
        resolve,
      });
    });

  const requestConfirm = ({
    title,
    message,
    detail,
    confirmLabel,
    danger = false,
  }: {
    title: string;
    message: string;
    detail?: string;
    confirmLabel: string;
    danger?: boolean;
  }) =>
    new Promise<boolean>((resolve) => {
      setAppDialog({
        type: "confirm",
        title,
        message,
        detail,
        confirmLabel,
        danger,
        resolve,
      });
    });

  const requestChoice = ({
    title,
    message,
    detail,
    primaryLabel,
    secondaryLabel,
  }: {
    title: string;
    message: string;
    detail?: string;
    primaryLabel: string;
    secondaryLabel: string;
  }) =>
    new Promise<"primary" | "secondary" | null>((resolve) => {
      setAppDialog({
        type: "choice",
        title,
        message,
        detail,
        primaryLabel,
        secondaryLabel,
        resolve,
      });
    });

  const closeAppDialog = () => {
    setAppDialog((current) => {
      if (!current) return null;
      if (current.type === "input") {
        current.resolve(null);
      } else if (current.type === "multiInput") {
        current.resolve(null);
      } else if (current.type === "createFile") {
        current.resolve(null);
      } else if (current.type === "confirm") {
        current.resolve(false);
      } else {
        current.resolve(null);
      }
      return null;
    });
  };

  const submitAppDialog = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppDialog((current) => {
      if (!current) return null;
      if (current.type === "confirm") {
        current.resolve(true);
        return null;
      }
      if (current.type === "choice") {
        current.resolve("primary");
        return null;
      }
      if (current.type === "options") return current;
      if (current.type === "multiInput") {
        const values: Record<string, string> = {};
        for (const field of current.fields) {
          const value = field.value.trim();
          if (!value && !field.optional) {
            return { ...current, error: `${field.label}を入力してください` };
          }
          values[field.id] = value;
        }
        current.resolve(values);
        return null;
      }
      if (current.type === "createFile") {
        const baseName = current.fileName.trim().replace(/\.(?:txt|md)$/i, "").trim();
        if (!baseName) {
          return { ...current, error: "テキストファイル名を入力してください" };
        }
        current.resolve({
          fileName: `${baseName}.${current.extension}`,
          templateId: current.templateId || null,
        });
        return null;
      }

      const value = current.value.trim();
      if (!value && !current.optional) {
        return { ...current, error: "名前を入力してください" };
      }
      current.resolve(value);
      return null;
    });
  };

  const updateAppDialogValue = (value: string) => {
    setAppDialog((current) =>
      current?.type === "input" ? { ...current, value, error: "" } : current,
    );
  };

  const updateAppDialogFieldValue = (fieldId: string, value: string) => {
    setAppDialog((current) => {
      if (current?.type === "createFile") {
        if (fieldId === "fileName") return { ...current, fileName: value, error: "" };
        if (fieldId === "extension") {
          return value === "txt" || value === "md"
            ? { ...current, extension: value, error: "" }
            : current;
        }
        if (fieldId === "templateId") return { ...current, templateId: value, error: "" };
        return current;
      }
      return current?.type === "multiInput"
        ? {
            ...current,
            fields: current.fields.map((field) =>
              field.id === fieldId ? { ...field, value } : field,
            ),
            error: "",
          }
        : current;
    });
  };

  const requestOption = ({
    title,
    message,
    detail,
    options,
  }: {
    title: string;
    message: string;
    detail?: string;
    options: { id: string; label: string; description?: string }[];
  }) =>
    new Promise<string | null>((resolve) => {
      setAppDialog({ type: "options", title, message, detail, options, resolve });
    });

  const chooseAppDialogOption = (id: string) => {
    setAppDialog((current) => {
      if (current?.type !== "options") return current;
      current.resolve(id);
      return null;
    });
  };

  const chooseAppDialog = (value: "primary" | "secondary") => {
    setAppDialog((current) => {
      if (current?.type !== "choice") return current;
      current.resolve(value);
      return null;
    });
  };

  return {
    appDialog,
    setAppDialog,
    requestInput,
    requestMultiInput,
    requestCreateFile,
    requestConfirm,
    requestChoice,
    requestOption,
    closeAppDialog,
    submitAppDialog,
    updateAppDialogValue,
    updateAppDialogFieldValue,
    chooseAppDialogOption,
    chooseAppDialog,
  };
}
