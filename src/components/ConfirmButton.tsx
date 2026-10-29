"use client";

import { useTransition } from "react";

/** Knopf für eine Server-Action, optional mit Sicherheitsabfrage (z. B. Papierkorb). */
export function ActionButton({
  action,
  confirm: question,
  className = "btn btn-sm",
  children,
  title,
}: {
  action: () => Promise<void>;
  confirm?: string;
  className?: string;
  children: React.ReactNode;
  title?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      title={title}
      onClick={() => {
        if (question && !window.confirm(question)) return;
        start(() => action());
      }}
    >
      {children}
    </button>
  );
}
