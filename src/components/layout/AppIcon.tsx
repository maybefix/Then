export type AppIconName =
  | "book"
  | "canvas"
  | "checkpointAdd"
  | "chevronDown"
  | "export"
  | "file"
  | "files"
  | "folder"
  | "folderPlus"
  | "fullscreen"
  | "fullscreenExit"
  | "history"
  | "horizontal"
  | "menu"
  | "openExternal"
  | "panelLeft"
  | "panelRight"
  | "plus"
  | "reference"
  | "search"
  | "settings"
  | "theme"
  | "vertical"
  | "write";

export function AppIcon({ name, className = "" }: { name: AppIconName; className?: string }) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    "aria-hidden": true,
    focusable: false,
  };

  switch (name) {
    case "book":
      return (
        <svg {...common}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      );
    case "canvas":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="7" height="6" rx="1.5" />
          <rect x="13" y="13" width="7" height="6" rx="1.5" />
          <path d="M11 8h3.5A2.5 2.5 0 0 1 17 10.5V13" />
          <path d="M13 16H9.5A2.5 2.5 0 0 1 7 13.5V11" />
        </svg>
      );
    case "chevronDown":
      return (
        <svg {...common}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case "export":
      return (
        <svg {...common}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M7 10l5 5 5-5" />
          <path d="M12 15V3" />
        </svg>
      );
    case "file":
      return (
        <svg {...common}>
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v6h6" />
        </svg>
      );
    case "files":
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v6h5" />
          <path d="M9 22h9a3 3 0 0 0 3-3V9" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
        </svg>
      );
    case "folderPlus":
      return (
        <svg {...common}>
          <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
          <path d="M12 10v6M9 13h6" />
        </svg>
      );
    case "fullscreen":
      return (
        <svg {...common}>
          <path d="M8 3H3v5" />
          <path d="M16 3h5v5" />
          <path d="M21 16v5h-5" />
          <path d="M8 21H3v-5" />
        </svg>
      );
    case "fullscreenExit":
      return (
        <svg {...common}>
          <path d="M3 9h6V3" />
          <path d="M21 9h-6V3" />
          <path d="M15 21v-6h6" />
          <path d="M9 21v-6H3" />
        </svg>
      );
    case "history":
      return (
        <svg {...common}>
          <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
          <path d="M3.5 4.5v4h4" />
          <path d="M12 7v5l3.5 2" />
        </svg>
      );
    case "checkpointAdd":
      return (
        <svg {...common}>
          <path d="M6.5 3.5h11v17l-5.5-4-5.5 4z" />
          <path d="M12 7.5v5M9.5 10h5" />
        </svg>
      );
    case "horizontal":
      return (
        <svg {...common}>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h10" />
        </svg>
      );
    case "menu":
      return (
        <svg {...common}>
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h16" />
        </svg>
      );
    case "openExternal":
      return (
        <svg {...common}>
          <path d="M14 4h6v6" />
          <path d="M20 4 11 13" />
          <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
        </svg>
      );
    case "panelLeft":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18" />
        </svg>
      );
    case "panelRight":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M15 3v18" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "reference":
      return (
        <svg {...common}>
          <path d="M7 3.5h7l3 3V20a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5Z" />
          <path d="M14 3.5V7h3.5" />
          <path d="M9 11h6" />
          <path d="M9 14h6" />
          <path d="M9 17h4" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="10.5" cy="10.5" r="7.25" />
          <path d="m16 16 5 5" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.04.04a2 2 0 1 1-2.83 2.83l-.04-.04a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.06A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.04.04a2 2 0 1 1-2.83-2.83l.04-.04A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.06A1.7 1.7 0 0 0 4.6 8.97a1.7 1.7 0 0 0-.34-1.88l-.04-.04a2 2 0 1 1 2.83-2.83l.04.04A1.7 1.7 0 0 0 8.97 4.6 1.7 1.7 0 0 0 10 3.06V3a2 2 0 1 1 4 0v.06a1.7 1.7 0 0 0 1.03 1.54 1.7 1.7 0 0 0 1.88-.34l.04-.04a2 2 0 1 1 2.83 2.83l-.04.04a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.94 10H21a2 2 0 1 1 0 4h-.06A1.7 1.7 0 0 0 19.4 15z" />
        </svg>
      );
    case "theme":
      return (
        <svg {...common}>
          <circle cx="13.5" cy="6.5" r="2.5" />
          <circle cx="7.5" cy="10.5" r="2.5" />
          <circle cx="16.5" cy="14.5" r="2.5" />
          <path d="M12 22a9 9 0 1 1 8.8-10.9 2.4 2.4 0 0 1-2.35 2.9H17a2 2 0 0 0 0 4h.35A2.4 2.4 0 0 1 19.7 21 9.1 9.1 0 0 1 12 22z" />
        </svg>
      );
    case "vertical":
      return (
        <svg {...common}>
          <path d="M7 4v16" />
          <path d="M12 4v16" />
          <path d="M17 4v10" />
        </svg>
      );
    case "write":
      return (
        <svg {...common}>
          <path d="M6 3h9l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
          <path d="M15 3v5h4" />
          <path d="M8 12h8M8 16h6" />
        </svg>
      );
    default:
      return null;
  }
}
