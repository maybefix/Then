import type { Dispatch, DragEvent, ReactNode, SetStateAction } from "react";
import type { IdeaFocusRequest } from "../../ideaThreadActions";
import type { DraftCanvasContext } from "../../intermediateDraft";
import type { LoadedThenPlugin, ThenPluginView } from "../../plugins/types";
import type { ProofreadTerm } from "../../proofread/terms";
import type { PropertyType, PropertyTypeSettings } from "../../properties/propertyModel";
import type { PropertySet } from "../../properties/propertySets";
import { mergeReferenceFiles, referenceFileKey } from "../../referenceFileKeys";
import type {
  AppState,
  CanvasScope,
  EditorSettings,
  IdeaThread,
  PlotCard,
  ProjectFolder,
  ReferenceFileInfo,
  ReferenceLayout,
} from "../../types";
import type { FrontMatterParts } from "../../utils/frontmatter";
import { AiPane } from "../ai/AiPane";
import { BinderPane } from "../binder/BinderPane";
import IntermediateDraftPane from "../canvas/IntermediateDraftPane";
import { PlotPane, PlotPaneHeaderActions } from "../plot/PlotPane";
import { PluginIcon } from "../plugins/PluginIcon";
import ProofreadPane from "../proofread/ProofreadPane";
import { PropertiesPanel } from "../properties/PropertiesPanel";
import { AppIcon } from "./AppIcon";
import { RightPaneSwitcher, type RightPaneSwitcherItem } from "./RightPaneSwitcher";

type AppMode = "write" | "canvas" | "export" | "checkpoint" | "plugin";

type ToastAction = {
  label: string;
  onClick: () => void;
};

type ProofreadIgnoredByPath = Record<string, string[]>;

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

const rightSidebarBuiltinTabs: Array<{ id: string; label: string; icon: ReactNode }> = [
  {
    id: "idea",
    label: "バインダー",
    icon: (
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M8.4 14.6c-1.7-1.2-2.6-3-2.6-5.1A6.2 6.2 0 0 1 12 3.3a6.2 6.2 0 0 1 6.2 6.2c0 2.1-.9 3.9-2.6 5.1-.8.6-1.2 1.3-1.3 2.2H9.7c-.1-.9-.5-1.6-1.3-2.2Z" />
      </svg>
    ),
  },
  {
    id: "plot",
    label: "プロット",
    icon: (
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M4 5.5c2.3-.9 4.8-.6 8 1.1v12c-3.2-1.7-5.7-2-8-1.1v-12Z" />
        <path d="M20 5.5c-2.3-.9-4.8-.6-8 1.1v12c3.2-1.7 5.7-2 8-1.1v-12Z" />
        <path d="M12 6.6v12" />
        <path d="M6.5 8.8c1.1-.1 2.2.1 3.4.7" />
        <path d="M17.5 8.8c-1.1-.1-2.2.1-3.4.7" />
      </svg>
    ),
  },
  {
    id: "proof",
    label: "校正",
    icon: (
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7Z" />
        <polyline points="14 3 14 7 18 7" />
        <polyline points="9 13.5 11 15.5 15 11" />
      </svg>
    ),
  },
  {
    id: "draft",
    label: "中間稿",
    icon: (
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M8 3h9l3 3v13H8Z" />
        <path d="M4 7v15h12M11 8h6M11 12h6M11 16h4" />
      </svg>
    ),
  },
  {
    id: "ai",
    label: "AI",
    icon: (
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-7l-4.5 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5Z" />
        <path d="M12 8.2v4.6M9.7 10.5h4.6" />
      </svg>
    ),
  },
  {
    id: "properties",
    label: "プロパティ",
    icon: (
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M4 6h3M4 12h3M4 18h3" />
        <path d="M10 6h10M10 12h10M10 18h6" />
      </svg>
    ),
  },
];

export type RightSidebarProps = {
  isRightSidebarWide: boolean;
  isRightSidebarCollapsed: boolean;
  appMode: AppMode;
  isEditorFocusMode: boolean;
  pluginViews: ThenPluginView[];
  loadedPlugins: LoadedThenPlugin[];
  rightSidebarTab: string;
  setRightSidebarTab: (tab: string) => void;
  addPlotSection: () => void;
  addPlotChapter: () => void;
  setIsPlotManagerOpen: Dispatch<SetStateAction<boolean>>;
  openIdeaCanvasBoard: (scope?: CanvasScope, boardId?: string, selectNodeId?: string) => Promise<void>;
  setIsRightSidebarWide: (wide: boolean) => void;
  setIsRightSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarPluginRuntimeAnchor: Dispatch<SetStateAction<HTMLDivElement | null>>;
  isDockedPluginRuntimeVisible: boolean;
  hasOpenedDraft: boolean;
  projectFolder: ProjectFolder | null;
  draftCanvasContext: DraftCanvasContext | null;
  setDraftSelectRequest: Dispatch<SetStateAction<{ id: string; nonce: number } | null>>;
  activePluginView: ThenPluginView | null;
  documentKey: string;
  frontMatter: FrontMatterParts;
  updateFrontMatter: (metadata: string) => void;
  handleClearFrontMatter: () => Promise<void>;
  propertyTypeSettings: PropertyTypeSettings;
  rememberPropertyType: (key: string, type: PropertyType) => void;
  returnFocusFromProperties: () => void;
  loadPropertySets: () => Promise<PropertySet[]>;
  searchByProperty: (key: string, value: string) => void;
  editorText: string;
  settings: EditorSettings;
  updateSettings: <Key extends keyof EditorSettings>(key: Key, value: EditorSettings[Key]) => void;
  revealEditorRange: (from: number, to: number) => void;
  replaceEditorRange: (from: number, to: number, insert: string) => void;
  projectProofreadTerms: ProofreadTerm[];
  appState: AppState;
  setProjectProofreadTerms: Dispatch<SetStateAction<ProofreadTerm[]>>;
  setAppState: Dispatch<SetStateAction<AppState>>;
  exportProofreadDictionary: (content: string) => Promise<string | null>;
  importProofreadDictionary: () => Promise<string | null>;
  projectProofreadIgnored: ProofreadIgnoredByPath;
  proofreadIgnoreKey: string;
  setProjectProofreadIgnored: Dispatch<SetStateAction<ProofreadIgnoredByPath>>;
  snippets: IdeaThread[];
  setReferenceCandidates: Dispatch<SetStateAction<ReferenceFileInfo[]>>;
  addReferencesToIdeaThread: (threadId: string, files: ReferenceFileInfo[]) => void;
  showToast: (message: string, action?: ToastAction | null) => void;
  openReferenceCard: (sourcePath: string, fileInfo?: ReferenceFileInfo, options?: { switchToReferenceTab?: boolean }) => void;
  aiInsertRequest: { text: string; nonce: number } | null;
  consumeAiInsertRequest: (nonce: number) => void;
  plotCards: PlotCard[];
  setPlotCards: Dispatch<SetStateAction<PlotCard[]>>;
  sortedReferenceCandidates: ReferenceFileInfo[];
  openPlotReference: (sourcePath: string, fileInfo: ReferenceFileInfo) => void;
  isPlotManagerOpen: boolean;
  transferMenuLabel: string | null;
  transferPlotCard: (cardId: string) => Promise<void>;
  referenceLayout: ReferenceLayout;
  draggingId: string | null;
  ideaFocusRequest: IdeaFocusRequest | null;
  setIdeaFocusRequest: Dispatch<SetStateAction<IdeaFocusRequest | null>>;
  captureFragment: (body: string, destId: string) => void;
  openIdeaBinderCard: (threadId: string, fragmentId: string) => void;
  createIdeaThread: (initialTitle?: string) => string;
  renameIdeaThread: (threadId: string, title: string) => void;
  toggleThreadStar: (threadId: string) => void;
  deleteIdeaThread: (threadId: string) => Promise<void>;
  addFragment: (threadId: string, body: string) => void;
  updateFragmentBody: (threadId: string, fragmentId: string, body: string) => void;
  deleteFragment: (threadId: string, fragmentId: string) => Promise<void>;
  moveFragment: (fromThreadId: string, fragmentId: string, toThreadId: string) => void;
  moveFragmentToNewThread: (fromThreadId: string, fragmentId: string) => Promise<void>;
  handTextToAi: (text: string) => void;
  handleFragmentDragStart: (event: DragEvent<HTMLElement>, threadId: string, fragmentId: string) => void;
  handleFragmentDragEnd: () => void;
  handleAddReference: (scope?: CanvasScope, targetThreadId?: string) => Promise<void>;
  handleCreateReference: (scope?: CanvasScope, targetThreadId?: string) => Promise<void>;
  moveIdeaReference: (fromThreadId: string, linkId: string, toThreadId: string, keepOriginal: boolean) => void;
  moveReferenceToNewThread: (fromThreadId: string, linkId: string, copy: boolean) => Promise<void>;
  removeIdeaReference: (threadId: string, linkId: string) => Promise<void>;
  handleDeleteImportedReference: (sourcePath: string, scope?: CanvasScope) => Promise<void>;
  reorderIdeaThreadItem: (threadId: string, itemKey: string, targetKey: string, position: "before" | "after") => void;
  transferIdeaThread: (threadId: string) => Promise<void>;
  transferIdeaFragment: (threadId: string, fragmentId: string) => Promise<void>;
  transferReferenceFile: (file: ReferenceFileInfo) => Promise<void>;
};

/**
 * 右サイドバー（補助ペイン）。値と、それを保存・復元する処理は App が持ち、
 * 描画のたびにその時点の値と操作を受け取る。
 */
export function RightSidebar(props: RightSidebarProps) {
  const {
    isRightSidebarWide, isRightSidebarCollapsed, appMode, isEditorFocusMode, pluginViews, loadedPlugins,
    rightSidebarTab, setRightSidebarTab, addPlotSection, addPlotChapter, setIsPlotManagerOpen,
    openIdeaCanvasBoard, setIsRightSidebarWide, setIsRightSidebarCollapsed, setSidebarPluginRuntimeAnchor,
    isDockedPluginRuntimeVisible, hasOpenedDraft, projectFolder, draftCanvasContext, setDraftSelectRequest,
    activePluginView, documentKey, frontMatter, updateFrontMatter, handleClearFrontMatter,
    propertyTypeSettings, rememberPropertyType, returnFocusFromProperties, loadPropertySets, searchByProperty,
    editorText, settings, updateSettings, revealEditorRange, replaceEditorRange, projectProofreadTerms,
    appState, setProjectProofreadTerms, setAppState, exportProofreadDictionary, importProofreadDictionary,
    projectProofreadIgnored, proofreadIgnoreKey, setProjectProofreadIgnored, snippets, setReferenceCandidates,
    addReferencesToIdeaThread, showToast, openReferenceCard, aiInsertRequest, consumeAiInsertRequest,
    plotCards, setPlotCards, sortedReferenceCandidates, openPlotReference, isPlotManagerOpen,
    transferMenuLabel, transferPlotCard, referenceLayout, draggingId, ideaFocusRequest, setIdeaFocusRequest,
    captureFragment, openIdeaBinderCard, createIdeaThread, renameIdeaThread, toggleThreadStar,
    deleteIdeaThread, addFragment, updateFragmentBody, deleteFragment, moveFragment, moveFragmentToNewThread,
    handTextToAi, handleFragmentDragStart, handleFragmentDragEnd, handleAddReference, handleCreateReference,
    moveIdeaReference, moveReferenceToNewThread, removeIdeaReference, handleDeleteImportedReference,
    reorderIdeaThreadItem, transferIdeaThread, transferIdeaFragment, transferReferenceFile
  } = props;
  const rightPaneSwitcherItems: RightPaneSwitcherItem[] = [
    ...rightSidebarBuiltinTabs,
    ...pluginViews.map((view) => {
      const icon = view.icon ?? loadedPlugins.find(
        (plugin) => plugin.manifest.id === view.pluginId,
      )?.manifest.icon;
      return {
        id: `plugin:${view.pluginId}:${view.id}`,
        label: view.title,
        icon: icon ? (
          <PluginIcon icon={icon} />
        ) : (
          <span className="pluginPaneInitial">{view.title.slice(0, 1).toUpperCase()}</span>
        ),
      };
    }),
  ];

  return (
    <aside
      className={`rightSidebar ${isRightSidebarWide ? "wideRightSidebar" : ""}${
        isRightSidebarCollapsed ? " collapsedRightSidebar" : ""
      }`}
      aria-label="補助ペイン"
      aria-hidden={appMode === "plugin" || isRightSidebarCollapsed || isEditorFocusMode}
      {...(
        appMode === "plugin" || isRightSidebarCollapsed || isEditorFocusMode
          ? { inert: "" }
          : {}
      )}
    >
        <div className="rightSidebarHeader">
          <RightPaneSwitcher
            items={rightPaneSwitcherItems}
            activeId={rightSidebarTab}
            onSelect={setRightSidebarTab}
          />
          {rightSidebarTab === "plot" && (
            <PlotPaneHeaderActions
              onAddSection={addPlotSection}
              onAddChapter={addPlotChapter}
              onOpenManager={() => setIsPlotManagerOpen(true)}
            />
          )}
          {rightSidebarTab === "idea" && (
            <div className="plotPaneHeaderActions" aria-label="バインダー操作">
              <button
                className="sidebarIconButton plotHeaderActionButton"
                type="button"
                aria-label="Idea Board を開く"
                title="Idea Board を開く"
                onClick={() => void openIdeaCanvasBoard("project")}
              >
                <AppIcon name="canvas" />
              </button>
            </div>
          )}
          <div className="rightSidebarChromeActions">
            <button
              className="sidebarIconButton"
              type="button"
              aria-label={isRightSidebarWide ? "ペイン幅を戻す" : "ペイン幅を拡張"}
              title={isRightSidebarWide ? "ペイン幅を戻す" : "ペイン幅を拡張"}
              onClick={() => setIsRightSidebarWide(!isRightSidebarWide)}
            >
              <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                <polyline points={isRightSidebarWide ? "9 18 15 12 9 6" : "15 18 9 12 15 6"} />
              </svg>
            </button>
            <button
              className="sidebarIconButton"
              type="button"
              aria-label="右サイドバーを畳む"
              title="右サイドバーを畳む"
              onClick={() => setIsRightSidebarCollapsed(true)}
            >
              <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        <div
          className={`rightSidebarBody ${
            rightSidebarTab === "plot" ? "plotRightSidebarBody" : ""
          }`}
        >
          <div
            ref={setSidebarPluginRuntimeAnchor}
            className={`pluginRuntimeAnchor${isDockedPluginRuntimeVisible ? " visiblePluginRuntimeAnchor" : ""}`}
            aria-hidden="true"
          />
          {hasOpenedDraft && <div className="draftPaneHost" hidden={rightSidebarTab !== "draft"}>
            <IntermediateDraftPane key={projectFolder?.path ?? "no-project"} rootPath={projectFolder?.path ?? null}
              liveCanvas={appMode === "canvas" ? draftCanvasContext : null}
              onOpenCanvas={(scope, boardId) => void openIdeaCanvasBoard(scope, boardId)}
              onSelectNode={(id) => setDraftSelectRequest({ id, nonce: Date.now() })} />
          </div>}
          {rightSidebarTab === "draft" ? null : activePluginView ? (
            <div className="pluginViewBody" aria-label={activePluginView.title} />
          ) : rightSidebarTab === "properties" ? (
            <PropertiesPanel
              documentKey={documentKey}
              metadata={frontMatter.metadata}
              hasFrontMatter={frontMatter.hasFrontMatter}
              onChangeMetadata={updateFrontMatter}
              onClear={handleClearFrontMatter}
              typeSettings={propertyTypeSettings}
              onRememberType={rememberPropertyType}
              onExit={returnFocusFromProperties}
              loadPropertySets={loadPropertySets}
              onSearchProperty={searchByProperty}
            />
          ) : rightSidebarTab === "proof" ? (
            <ProofreadPane
              text={editorText}
              documentKey={documentKey}
              active={!isRightSidebarCollapsed && !isEditorFocusMode && appMode !== "plugin"}
              options={settings.proofread}
              onOptionsChange={(next) =>
                updateSettings("proofread", {
                  ...next,
                  disabledRules: settings.proofread.disabledRules,
                })
              }
              disabledRuleIds={settings.proofread.disabledRules}
              onDisabledRuleIdsChange={(ruleIds) =>
                updateSettings("proofread", {
                  ...settings.proofread,
                  disabledRules: ruleIds,
                })
              }
              onJump={revealEditorRange}
              onReplace={replaceEditorRange}
              projectTerms={projectProofreadTerms}
              globalTerms={appState.proofreadTerms}
              hasProject={Boolean(projectFolder)}
              onProjectTermsChange={setProjectProofreadTerms}
              onGlobalTermsChange={(terms) =>
                setAppState((current) => ({ ...current, proofreadTerms: terms }))
              }
              onExportTermFile={exportProofreadDictionary}
              onImportTermFile={importProofreadDictionary}
              canUseTermFiles={isTauriRuntime()}
              ignoredKeys={projectProofreadIgnored[proofreadIgnoreKey] ?? []}
              onIgnoredKeysChange={(keys) =>
                setProjectProofreadIgnored((current) => {
                  const next = { ...current };
                  if (keys.length) next[proofreadIgnoreKey] = keys;
                  else delete next[proofreadIgnoreKey];
                  return next;
                })
              }
              disabledCheckIds={settings.proofread.disabledChecks}
              onDisabledCheckIdsChange={(checkIds) =>
                updateSettings("proofread", {
                  ...settings.proofread,
                  disabledChecks: checkIds,
                })
              }
            />
          ) : rightSidebarTab === "ai" ? (
            <AiPane
              rootPath={projectFolder?.path ?? null}
              settings={settings.ai}
              threads={snippets}
              onReferenceSaved={(threadId, file) => {
                setReferenceCandidates((current) =>
                  mergeReferenceFiles([file], current).sort((left, right) =>
                    left.sourcePath.localeCompare(right.sourcePath),
                  ),
                );
                addReferencesToIdeaThread(threadId, [file]);
                showToast(`「${file.name}」を資料に保存しました`);
              }}
              onOpenReference={(file) => openReferenceCard(file.sourcePath, file, { switchToReferenceTab: false })}
              insertRequest={aiInsertRequest}
              onInsertConsumed={consumeAiInsertRequest}
            />
          ) : rightSidebarTab === "plot" ? (
            <PlotPane
              cards={plotCards}
              onCardsChange={setPlotCards}
              referenceCandidates={sortedReferenceCandidates}
              onOpenReference={openPlotReference}
              onMissingReference={() => showToast("存在しないファイルです")}
              onNotify={showToast}
              isManagerOpen={isPlotManagerOpen}
              onManagerOpenChange={setIsPlotManagerOpen}
              transfer={
                transferMenuLabel
                  ? { label: transferMenuLabel, onTransfer: (cardId) => void transferPlotCard(cardId) }
                  : undefined
              }
            />
          ) : (
            <BinderPane
              rootPath={projectFolder?.path ?? null}
              threads={snippets}
              threadLayouts={referenceLayout.ideaThreads}
              candidates={sortedReferenceCandidates}
              draggingId={draggingId}
              focusRequest={ideaFocusRequest}
              onFocusRequestConsumed={(nonce) =>
                setIdeaFocusRequest((current) =>
                  current?.nonce === nonce ? null : current,
                )
              }
              onCapture={captureFragment}
              onOpenIdea={openIdeaBinderCard}
              onCreateThread={createIdeaThread}
              onRenameThread={renameIdeaThread}
              onToggleStar={toggleThreadStar}
              onDeleteThread={deleteIdeaThread}
              onAddFragment={addFragment}
              onUpdateFragment={updateFragmentBody}
              onDeleteFragment={deleteFragment}
              onMoveFragment={moveFragment}
              onMoveFragmentToNewThread={(threadId, fragmentId) =>
                void moveFragmentToNewThread(threadId, fragmentId)
              }
              onAskAi={handTextToAi}
              onFragmentDragStart={handleFragmentDragStart}
              onFragmentDragEnd={handleFragmentDragEnd}
              onAddReference={(threadId) => void handleAddReference("project", threadId)}
              onCreateReference={(threadId) => void handleCreateReference("project", threadId)}
              onOpenReference={(targetFile) => {
                const file =
                  sortedReferenceCandidates.find(
                    (item) => referenceFileKey(item) === referenceFileKey(targetFile),
                  ) ?? targetFile;
                openReferenceCard(file.sourcePath, file, { switchToReferenceTab: false });
              }}
              onMoveReference={moveIdeaReference}
              onMoveReferenceToNewThread={(threadId, linkId, copy) =>
                void moveReferenceToNewThread(threadId, linkId, copy)
              }
              onRemoveReference={(threadId, linkId) => void removeIdeaReference(threadId, linkId)}
              onDeleteReferenceFile={(file) =>
                void handleDeleteImportedReference(file.sourcePath, file.scope)
              }
              onReorderItem={reorderIdeaThreadItem}
              transfer={
                transferMenuLabel
                  ? {
                      label: transferMenuLabel,
                      onThread: (threadId) => void transferIdeaThread(threadId),
                      onFragment: (threadId, fragmentId) => void transferIdeaFragment(threadId, fragmentId),
                      onReferenceFile: (file) => void transferReferenceFile(file),
                    }
                  : undefined
              }
            />
          )}
        </div>
    </aside>
  );
}
