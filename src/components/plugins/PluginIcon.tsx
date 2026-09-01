import type { ThenPluginIcon as ThenPluginIconDefinition } from "../../plugins/types";

type PluginIconProps = {
  icon: ThenPluginIconDefinition;
  className?: string;
};

/**
 * Plugin icons are declarative SVG path data only. They never enter the DOM as
 * markup, so a plugin cannot use an icon to inject HTML or script into Then.
 */
export function PluginIcon({ icon, className }: PluginIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      viewBox="0 0 24 24"
    >
      {icon.paths.map((path, index) => <path d={path} key={`${index}:${path}`} />)}
    </svg>
  );
}
