import {
  useEffect,
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
  /** 実行不可な場合の理由。設定すると選択不可・淡色表示になる。 */
  disabledReason?: string;
  run: () => void;
};

type CommandPaletteProps = {
  commands: PaletteCommand[];
  onClose: () => void;
};

function matchesQuery(command: PaletteCommand, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    command.label.toLowerCase().includes(needle) ||
    (command.hint?.toLowerCase().includes(needle) ?? false)
  );
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const filtered = useMemo(
    () => commands.filter((command) => matchesQuery(command, query)),
    [commands, query],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const active = listRef.current?.children[activeIndex];
    if (active instanceof HTMLElement) {
      active.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  const runCommand = (command: PaletteCommand | undefined) => {
    if (!command || command.disabledReason) return;
    onClose();
    command.run();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (filtered.length ? (index + 1) % filtered.length : 0));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        filtered.length ? (index - 1 + filtered.length) % filtered.length : 0,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      runCommand(filtered[activeIndex]);
    }
  };

  return (
    <div className="modalBackdrop commandPaletteBackdrop" role="presentation" onMouseDown={onClose}>
      <div
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
          onChange={(event) => setQuery(event.target.value)}
          spellCheck={false}
          aria-label="コマンド検索"
        />
        {filtered.length === 0 ? (
          <p className="commandPaletteEmpty">一致するコマンドがありません</p>
        ) : (
          <ul className="commandPaletteList" ref={listRef} role="listbox">
            {filtered.map((command, index) => (
              <li
                key={command.id}
                role="option"
                aria-selected={index === activeIndex}
                aria-disabled={Boolean(command.disabledReason)}
                className={`commandPaletteItem${index === activeIndex ? " active" : ""}${
                  command.disabledReason ? " disabled" : ""
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  runCommand(command);
                }}
                title={command.disabledReason}
              >
                <span className="commandPaletteLabel">{command.label}</span>
                {command.hint && <span className="commandPaletteHint">{command.hint}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
