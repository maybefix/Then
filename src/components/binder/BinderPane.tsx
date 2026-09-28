import type { DragEvent } from "react";
import type {
  IdeaThread,
  IdeaThreadLayout,
  ReferenceFileInfo,
} from "../../types";
import { IdeaPane } from "../snippets/IdeaPane";

type BinderPaneProps = {
  rootPath: string | null;
  threads: IdeaThread[];
  threadLayouts: IdeaThreadLayout[];
  candidates: ReferenceFileInfo[];
  draggingId: string | null;
  focusRequest?: { threadId: string; fragmentId?: string; nonce: number } | null;
  onFocusRequestConsumed?: (nonce: number) => void;
  onCapture: (body: string, destId: string) => void;
  onOpenIdea: (threadId: string, fragmentId: string) => void;
  onCreateThread: () => string;
  onRenameThread: (threadId: string, title: string) => void;
  onToggleStar: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onAddFragment: (threadId: string, body: string) => void;
  onUpdateFragment: (threadId: string, fragmentId: string, body: string) => void;
  onDeleteFragment: (threadId: string, fragmentId: string) => void;
  onMoveFragment: (fromThreadId: string, fragmentId: string, toThreadId: string) => void;
  onMoveFragmentToNewThread: (fromThreadId: string, fragmentId: string) => void;
  onFragmentDragStart: (event: DragEvent<HTMLElement>, threadId: string, fragmentId: string) => void;
  onFragmentDragEnd: () => void;
  onAddReference: (threadId: string) => void;
  onCreateReference: (threadId: string) => void;
  onOpenReference: (file: ReferenceFileInfo) => void;
  onMoveReference: (fromThreadId: string, linkId: string, toThreadId: string, copy: boolean) => void;
  onMoveReferenceToNewThread: (fromThreadId: string, linkId: string, copy: boolean) => void;
  onRemoveReference: (threadId: string, linkId: string) => void;
  onDeleteReferenceFile: (file: ReferenceFileInfo) => void;
  onReorderItem: (
    threadId: string,
    itemKey: string,
    targetKey: string,
    position: "before" | "after",
  ) => void;
};

/**
 * 旧バインダー表示の互換境界。日常操作は IdeaPane 一つへ統合し、
 * 資料はスレッド内でだけ整理する。
 */
export function BinderPane(props: BinderPaneProps) {
  return (
    <section className="binderPane" aria-label="Idea">
      <IdeaPane
        rootPath={props.rootPath}
        threads={props.threads}
        threadLayouts={props.threadLayouts}
        candidates={props.candidates}
        draggingId={props.draggingId}
        focusRequest={props.focusRequest}
        onFocusRequestConsumed={props.onFocusRequestConsumed}
        onCapture={props.onCapture}
        onCreateThread={props.onCreateThread}
        onRenameThread={props.onRenameThread}
        onToggleStar={props.onToggleStar}
        onDeleteThread={props.onDeleteThread}
        onAddFragment={props.onAddFragment}
        onUpdateFragment={props.onUpdateFragment}
        onDeleteFragment={props.onDeleteFragment}
        onMoveFragment={props.onMoveFragment}
        onMoveFragmentToNewThread={props.onMoveFragmentToNewThread}
        onFragmentDragStart={props.onFragmentDragStart}
        onFragmentDragEnd={props.onFragmentDragEnd}
        onOpenFragmentCard={props.onOpenIdea}
        onAddReference={props.onAddReference}
        onCreateReference={props.onCreateReference}
        onOpenReference={props.onOpenReference}
        onMoveReference={props.onMoveReference}
        onMoveReferenceToNewThread={props.onMoveReferenceToNewThread}
        onRemoveReference={props.onRemoveReference}
        onDeleteReferenceFile={props.onDeleteReferenceFile}
        onReorderItem={props.onReorderItem}
      />
    </section>
  );
}
