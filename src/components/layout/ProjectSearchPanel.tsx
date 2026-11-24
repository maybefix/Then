import { useMemo, useState, type RefObject } from "react";
import type { ProjectAst, ProjectSearchOutcome, ProjectSearchResult } from "../../editor/ast/types";
import type { LibraryContext } from "../../types";
import { AppIcon } from "./AppIcon";

export type WorkspaceSearchScope = "file" | "project" | "library";

type ProjectSearchPanelProps = {
  inputRef: RefObject<HTMLInputElement>;
  hasProject: boolean;
  projectAst: ProjectAst | null;
  library: LibraryContext | null;
  isLibrarySearchLoading: boolean;
  projectSearchQuery: string;
  outcome: ProjectSearchOutcome;
  projectSearchUseRegex: boolean;
  projectSearchMatchCase: boolean;
  projectSearchIncludeComments: boolean;
  searchScope: WorkspaceSearchScope;
  projectReplaceValue: string;
  isProjectReplacing: boolean;
  onProjectSearchQueryChange: (value: string) => void;
  onProjectSearchUseRegexChange: (value: boolean) => void;
  onProjectSearchMatchCaseChange: (value: boolean) => void;
  onProjectSearchIncludeCommentsChange: (value: boolean) => void;
  onSearchScopeChange: (value: WorkspaceSearchScope) => void;
  onProjectReplaceValueChange: (value: string) => void;
  onOpenProjectSearchResult: (result: ProjectSearchResult) => void;
  onReplaceInCurrentFile: () => void;
  onReplaceInProject: () => void;
};

function getProjectAstStatusLabel(projectAst: ProjectAst | null): string | null {
  if (!projectAst || projectAst.status === "empty" || projectAst.status === "ready") return null;
  if (projectAst.status === "indexing") {
    return `索引作成中 ${projectAst.indexedCount}/${projectAst.files.length}`;
  }
  if (projectAst.status === "partial") return `索引エラー ${projectAst.errorCount}件`;
  return null;
}

export function ProjectSearchPanel({
  inputRef, hasProject, projectAst, library, isLibrarySearchLoading, projectSearchQuery, outcome,
  projectSearchUseRegex, projectSearchMatchCase, projectSearchIncludeComments, searchScope,
  projectReplaceValue, isProjectReplacing, onProjectSearchQueryChange, onProjectSearchUseRegexChange,
  onProjectSearchMatchCaseChange, onProjectSearchIncludeCommentsChange, onSearchScopeChange,
  onProjectReplaceValueChange, onOpenProjectSearchResult, onReplaceInCurrentFile, onReplaceInProject,
}: ProjectSearchPanelProps) {
  const { results: projectSearchResults, total: projectSearchTotal, matchedFileCount: projectSearchMatchedFileCount,
    truncated: projectSearchTruncated, error: projectSearchError } = outcome;
  const [isReplaceExpanded, setIsReplaceExpanded] = useState(false);

  const groupedProjectSearchResults = useMemo(() => {
    const groups: { path: string; name: string; count: number; results: ProjectSearchResult[] }[] = [];
    const byPath = new Map<string, (typeof groups)[number]>();
    for (const result of projectSearchResults) {
      const key = result.path || "__current_document__";
      let group = byPath.get(key);
      if (!group) {
        group = {
          path: result.path,
          name: result.name,
          count: result.fileMatchCount ?? 0,
          results: [],
        };
        byPath.set(key, group);
        groups.push(group);
      }
      group.results.push(result);
      group.count = Math.max(group.count, result.fileMatchCount ?? group.results.length);
    }
    return groups;
  }, [projectSearchResults]);

  const emptyProjectSearchMessage = projectSearchQuery.length === 0
      ? "検索語句を入力"
      : searchScope === "project" && !hasProject
        ? "プロジェクトを開いてください"
        : searchScope === "project" &&
            projectAst?.status === "indexing" &&
            !projectSearchResults.length
          ? "検索用の索引を作成中"
          : searchScope === "file"
            ? "現在の本文に一致がありません"
            : "プロジェクト内に一致がありません";

  // 範囲ボタンは一行に収まる短い名前にし、正式な名前は読み上げとツールチップで示す。
  const searchScopeOptions: { scope: WorkspaceSearchScope; label: string; name: string; title: string }[] =
    library
      ? [
          { scope: "file", label: "文書", name: "現在の本文", title: "開いている文書だけを検索" },
          library.role === "root"
            ? { scope: "project", label: "直下", name: "ライブラリ直下", title: "ライブラリ直下の文書を検索（作品は含まない）" }
            : { scope: "project", label: "作品", name: "この作品", title: "この作品の文書を検索" },
          {
            scope: "library",
            label: "ライブラリ",
            name: "ライブラリ全体",
            title: "ライブラリ直下とすべての作品を検索（置換はできません）",
          },
        ]
      : [
          { scope: "file", label: "現在の本文", name: "現在の本文", title: "開いている文書だけを検索" },
          { scope: "project", label: "プロジェクト", name: "プロジェクト", title: "プロジェクトの文書を検索" },
        ];
  const activeScopeOption =
    searchScopeOptions.find((option) => option.scope === searchScope) ?? searchScopeOptions[0];
  const indexStatus = searchScope === "project" ? getProjectAstStatusLabel(projectAst) : null;
  const hasQuery = projectSearchQuery.length > 0;
  const replaceCount = projectSearchTotal;

  return (
    <div className="sidebarScroll projectSearchSidebarScroll">
      <section className="sidebarSection projectSearchModeSection" aria-label="検索と置換">
        <div className={`projectSearchInputShell ${projectSearchError ? "projectSearchInputError" : ""}`}>
          <AppIcon name="search" className="searchSvgIcon" />
          <input
            ref={inputRef}
            value={projectSearchQuery}
            onChange={(event) => onProjectSearchQueryChange(event.target.value)}
            placeholder="本文を検索"
            aria-label="検索語句"
            type="text"
            spellCheck={false}
          />
          <div className="projectSearchOptions" role="group" aria-label="検索オプション">
            <button
              className={projectSearchMatchCase ? "activeSearchOption" : ""}
              type="button"
              title="大文字と小文字を区別"
              aria-label="大文字と小文字を区別"
              aria-pressed={projectSearchMatchCase}
              onClick={() => onProjectSearchMatchCaseChange(!projectSearchMatchCase)}
            >
              Aa
            </button>
            <button
              className={projectSearchUseRegex ? "activeSearchOption" : ""}
              type="button"
              title="正規表現を使用（^ と $ は各行の先頭・末尾）"
              aria-label="正規表現を使用"
              aria-pressed={projectSearchUseRegex}
              onClick={() => onProjectSearchUseRegexChange(!projectSearchUseRegex)}
            >
              .*
            </button>
            <button
              className={projectSearchIncludeComments ? "activeSearchOption" : ""}
              type="button"
              title="コメント行も検索・置換の対象にする"
              aria-label="コメントを含む"
              aria-pressed={projectSearchIncludeComments}
              onClick={() => onProjectSearchIncludeCommentsChange(!projectSearchIncludeComments)}
            >
              //
            </button>
          </div>
        </div>
        {projectSearchError && (
          <p className="projectSearchError" role="alert">
            正規表現に誤りがあります：{projectSearchError}
          </p>
        )}
        <div className="projectSearchScopeRow">
          <span>範囲</span>
          <div className="projectSearchModes" role="group" aria-label="検索範囲">
            {searchScopeOptions.map((option) => (
              <button
                key={option.scope}
                className={searchScope === option.scope ? "activeProjectSearchMode" : ""}
                type="button"
                aria-pressed={searchScope === option.scope}
                aria-label={option.name}
                title={option.title}
                disabled={option.scope !== "file" && !hasProject}
                onClick={() => onSearchScopeChange(option.scope)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="projectReplaceDisclosure">
          <button
            className="projectReplaceToggle"
            type="button"
            aria-expanded={isReplaceExpanded}
            onClick={() => setIsReplaceExpanded((current) => !current)}
          >
            <span>置換</span>
            <AppIcon name="chevronDown" className="projectReplaceToggleIcon" />
          </button>
          {isReplaceExpanded && (
            <div className="projectReplacePanel">
              <label>
                <span>{projectSearchUseRegex ? "置換後（$1 などを使用可）" : "置換後"}</span>
                <input
                  value={projectReplaceValue}
                  onChange={(event) => onProjectReplaceValueChange(event.target.value)}
                  placeholder="置換する文字列"
                />
              </label>
              <div className="projectReplaceActions">
                <button
                  type="button"
                  disabled={
                    isProjectReplacing ||
                    !hasQuery ||
                    Boolean(projectSearchError) ||
                    replaceCount === 0 ||
                    searchScope === "library" ||
                    (searchScope === "project" && !hasProject)
                  }
                  onClick={searchScope === "file" ? onReplaceInCurrentFile : onReplaceInProject}
                >
                  {isProjectReplacing
                    ? "置換中…"
                    : searchScope === "library"
                      ? "ライブラリ全体は置換できません"
                      : searchScope === "file"
                        ? `${replaceCount}件を置換`
                        : `${projectSearchMatchedFileCount}ファイル・${replaceCount}件を置換`}
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="projectSearchSummary" aria-live="polite">
          <span title="本文が対象です。メタデータ（フロントマター）は検索しません。">
            {hasQuery && !projectSearchError
              ? searchScope === "file"
                ? `${activeScopeOption.name} · ${projectSearchTotal}件`
                : `${activeScopeOption.name} · ${projectSearchTotal}件・${projectSearchMatchedFileCount}ファイル`
              : activeScopeOption.name}
          </span>
          {indexStatus && <span>{indexStatus}</span>}
          {searchScope === "library" && isLibrarySearchLoading && <span>ほかの作品を読み込み中</span>}
        </div>
        <div className="projectSearchList">
          {groupedProjectSearchResults.length ? (
            groupedProjectSearchResults.map((group) => (
              <section className="projectSearchResultGroup" key={group.path || group.name}>
                <header className="projectSearchResultGroupHeader" title={group.path}>
                  <span>{group.name}</span>
                  <span>{group.count}件</span>
                </header>
                {group.results.map((result) => (
                  <button
                    className="projectSearchResultItem"
                    key={result.id}
                    type="button"
                    title={`${result.path || result.name} ${result.line}行 ${result.column}列`}
                    onClick={() => onOpenProjectSearchResult(result)}
                  >
                    <span className="projectSearchResultMeta">
                      <span>{result.title ?? "本文"}</span>
                      <span>{result.line}行 {result.column}列</span>
                    </span>
                    <span className="projectSearchResultExcerpt">
                      {result.excerptBefore ?? result.excerpt}
                      {result.excerptMatch !== undefined && (
                        <mark className={result.matchLength === 0 ? "zeroLengthSearchMatch" : ""}>
                          {result.excerptMatch || "│"}
                        </mark>
                      )}
                      {result.excerptAfter ?? ""}
                    </span>
                  </button>
                ))}
              </section>
            ))
          ) : projectSearchError ? null : (
            <div className="outlineEmptyState">{emptyProjectSearchMessage}</div>
          )}
          {projectSearchTruncated && (
            <div className="projectSearchLimitNotice">
              先頭{projectSearchResults.length}件を表示しています
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
