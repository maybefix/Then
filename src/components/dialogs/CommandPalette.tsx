import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

export type PaletteCommand = {
  id: string;
  label: string;
  /** 右側に表示する補助情報（ショートカットや記法など）。 */
  hint?: string;
  /** 実行不可な場合の理由。設定すると理由を表示し、実行を無効にする。 */
  disabledReason?: string;
  run: () => void;
};

type CommandPaletteProps = {
  commands: PaletteCommand[];
  onClose: (reason: "dismiss" | "command") => void;
  /**
   * 閉じたあと、開く前のフォーカス先へ戻す方法。既定は DOM の focus()。
   * 本文エディタは DOM の focus() だとブラウザがキャレットを置き直すため、
   * 呼び出し側がエディタ自身の選択を保つ復帰に差し替える。
   */
  restoreFocus?: (target: HTMLElement) => void;
};

const focusElement = (target: HTMLElement) => target.focus({ preventScroll: true });

function matchesQuery(command: PaletteCommand, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    command.label.toLowerCase().includes(needle) ||
    (command.hint?.toLowerCase().includes(needle) ?? false)
  );
}

export function CommandPalette({ commands, onClose, restoreFocus = focusElement }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const isClosingRef = useRef(false);
  const restoreFocusRef = useRef(restoreFocus);
  restoreFocusRef.current = restoreFocus;
  // 描画時点ではまだ入力欄へ移っていない。StrictMode の effect 再実行で
  // 入力欄を「前のフォーカス」と取り違えないよう、初回描画で一度だけ控える。
  const [previouslyFocused] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  const filtered = useMemo(
    () => commands.filter((command) => matchesQuery(command, query)),
    [commands, query],
  );
  const selectedIndex = Math.min(activeIndex, Math.max(0, filtered.length - 1));
  const optionId = (command: PaletteCommand) => `${listId}-option-${encodeURIComponent(command.id)}`;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const input = inputRef.current;
    if (!dialog || !input) return;

    const isTopmostDialog = () => {
      const dialogs = document.querySelectorAll('[aria-modal="true"]');
      return dialogs[dialogs.length - 1] === dialog;
    };
    input.focus({ preventScroll: true });

    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || isClosingRef.current || !isTopmostDialog()) return;
      event.preventDefault();
      input.focus({ preventScroll: true });
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (!isClosingRef.current && isTopmostDialog() && !dialog.contains(event.target as Node)) {
        input.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", keepFocusInside, true);
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      window.removeEventListener("keydown", keepFocusInside, true);
      document.removeEventListener("focusin", handleFocusIn);
      if (!isClosingRef.current) return;
      // パレットが DOM から外れてから復帰し、その間に実行したコマンドが
      // 別の要素へフォーカスを移していた場合は触れない。
      window.setTimeout(() => {
        if (
          previouslyFocused?.isConnected &&
          (document.activeElement === document.body || dialog.contains(document.activeElement))
        ) {
          restoreFocusRef.current(previouslyFocused);
        }
      }, 0);
    };
  }, [previouslyFocused]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    const active = listRef.current?.children[selectedIndex];
    if (active instanceof HTMLElement) {
      active.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, query, filtered.length]);

  const closePalette = (reason: "dismiss" | "command") => {
    isClosingRef.current = true;
    onClose(reason);
  };

  const runCommand = (command: PaletteCommand | undefined) => {
    if (!command || command.disabledReason) return;
    closePalette("command");
    command.run();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePalette("dismiss");
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(filtered.length ? (selectedIndex + 1) % filtered.length : 0);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(filtered.length ? (selectedIndex - 1 + filtered.length) % filtered.length : 0);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      runCommand(filtered[selectedIndex]);
    }
  };

  return (
    <div className="modalBackdrop commandPaletteBackdrop" role="presentation" onMouseDown={() => closePalette("dismiss")}>
      <div
        ref={dialogRef}
        className="commandPalette"
        role="dialog"
        aria-modal="true"
        aria-label="コマンドパレット"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          className="commandPaletteInput"
          type="text"
          placeholder="コマンドを検索…"
          value={query}
          spellCheck={false}
          aria-label="コマンド検索"
          role="combobox"
          aria-autocomplete="none"
          aria-expanded={filtered.length > 0}
          aria-controls={filtered.length > 0 ? listId : undefined}
          aria-activedescendant={filtered[selectedIndex] ? optionId(filtered[selectedIndex]) : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
        />
        {filtered.length === 0 ? (
          <p className="commandPaletteEmpty" role="status">
            一致するコマンドがありません
          </p>
        ) : (
          <ul
            className="commandPaletteList"
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="コマンド"
          >
            {filtered.map((command, index) => (
              <li
                key={command.id}
                id={optionId(command)}
                role="option"
                aria-selected={index === selectedIndex}
                aria-disabled={Boolean(command.disabledReason)}
                className={`commandPaletteItem${index === selectedIndex ? " active" : ""}${
                  command.disabledReason ? " disabled" : ""
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  runCommand(command);
                }}
              >
                <span className="commandPaletteText">
                  <span className="commandPaletteLabel">{command.label}</span>
                  {command.disabledReason && (
                    <span className="commandPaletteDisabledReason">{command.disabledReason}</span>
                  )}
                </span>
                {command.hint && <span className="commandPaletteHint">{command.hint}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
