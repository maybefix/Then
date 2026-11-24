import type { ReactNode } from "react";

export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settingsGroup" aria-label={title}>
      <h4>{title}</h4>
      {children}
    </section>
  );
}
