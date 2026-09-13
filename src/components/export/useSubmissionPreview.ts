import { useEffect, useRef, useState } from "react";
import { SubmissionClient } from "../../export/submission/submissionClient";
import type { LoadedExportSource } from "../../export/types";
import type { SubmissionExportOptions, SubmissionExportResult } from "../../export/submission/types";

export function useSubmissionPreview(sources: LoadedExportSource[], title: string, options: SubmissionExportOptions) {
  const client = useRef<SubmissionClient | null>(null);
  const [retry, setRetry] = useState(0);
  const [completed, setCompleted] = useState<{
    sources: LoadedExportSource[]; title: string; options: SubmissionExportOptions; retry: number;
    result: SubmissionExportResult | null; error: string;
  } | null>(null);
  useEffect(() => {
    client.current = new SubmissionClient();
    return () => { client.current?.dispose(); client.current = null; };
  }, []);
  useEffect(() => {
    let active = true;
    client.current!.convert(sources, title, options).then(
      result => { if (active) setCompleted({ sources, title, options, retry, result, error: "" }); },
      error => { if (active) setCompleted({ sources, title, options, retry, result: null, error: String(error) }); },
    );
    return () => { active = false; };
  }, [sources, title, options, retry]);
  const current = completed?.sources === sources && completed.title === title && completed.options === options && completed.retry === retry;
  return { result: current ? completed.result : null, error: current ? completed.error : "", loading: !current,
    retry: () => { client.current?.dispose(); client.current = new SubmissionClient(); setRetry(value => value + 1); } };
}
