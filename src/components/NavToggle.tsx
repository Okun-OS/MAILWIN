"use client";

import { Icon } from "./Icon";

export function NavToggle() {
  return (
    <button className="icon-btn mobile-only" aria-label="Menü öffnen" onClick={() => window.dispatchEvent(new Event("mw:toggle-nav"))}>
      <Icon name="menu" size={20} />
    </button>
  );
}
