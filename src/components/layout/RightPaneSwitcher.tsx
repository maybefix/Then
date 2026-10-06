import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

export type RightPaneSwitcherItem = {
  id: string;
  label: string;
  icon: ReactNode;
};

type RightPaneSwitcherProps = {
  items: readonly RightPaneSwitcherItem[];
  activeId: string;
  onSelect: (id: string) => void;
};

/**
 * 右サイドバー下端の切り替え。上部バーの画面モードと同じ「アイコン＋機能名」の
 * プルダウンで、ペインの下端にあるため上向きに開く。
 */
export function RightPaneSwitcher({ items, activeId, onSelect }: RightPaneSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const active = items.find((item) => item.id === activeId) ?? items[0];

  useEffect(() => {
    if (!isOpen) return;
    // 開いたら現在のペインにフォーカスし、矢印キーでそのまま選べるようにする。
    const menu = rootRef.current;
    const target =
      menu?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]') ??
      menu?.querySelector<HTMLButtonElement>('[role="menuitemradio"]');
    target?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const menuItems = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    );
    if (menuItems.length === 0) return;
    const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % menuItems.length;
    else if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + menuItems.length) % menuItems.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = menuItems.length - 1;
    else if (event.key === "Escape") {
      // 他の Escape 処理（フォーカスモード解除など）まで届かせない。
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      buttonRef.current?.focus();
      return;
    } else if (event.key === "Tab") {
      setIsOpen(false);
      return;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    menuItems[nextIndex].focus();
  };

  if (!active) return null;

  return (
    <div className="rightPaneSwitcher" ref={rootRef}>
      <button
        ref={buttonRef}
        className="rightPaneSwitcherButton"
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`補助ペイン：${active.label}`}
        title="補助ペインを切り替え"
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            setIsOpen(true);
          }
        }}
      >
        <span className="rightPaneSwitcherIcon" aria-hidden="true">{active.icon}</span>
        <span className="rightPaneSwitcherLabel">{active.label}</span>
        <svg className="rightPaneSwitcherChevron" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
          <polyline points="6 15 12 9 18 15" />
        </svg>
      </button>
      {isOpen && (
        <div
          className="menuPopover rightPaneSwitcherPopover"
          role="menu"
          aria-label="補助ペイン"
          onKeyDown={handleMenuKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.id}
              className={item.id === active.id ? "activeMenuItem" : ""}
              type="button"
              role="menuitemradio"
              aria-checked={item.id === active.id}
              onClick={() => {
                setIsOpen(false);
                buttonRef.current?.focus();
                onSelect(item.id);
              }}
            >
              <span className="rightPaneSwitcherIcon" aria-hidden="true">{item.icon}</span>
              <span className="rightPaneSwitcherItemLabel">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
