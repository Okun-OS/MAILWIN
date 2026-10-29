"use client";

import { useActionState } from "react";
import { startProjectAction, type ActionState } from "@/app/(app)/actions";
import { Icon } from "./Icon";

export function ProjectStartForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(startProjectAction, null);
  return (
    <form action={action}>
      <textarea
        name="goal"
        className="textarea"
        style={{ minHeight: 130 }}
        placeholder="z. B. „Wir wollen unsere Software zertifizieren lassen. Finde heraus, welche Stellen zuständig sind und welche Schritte nötig sind.“"
        required
        disabled={pending}
      />
      {state?.error && <div className="notice error" style={{ marginTop: 10 }}>{state.error}</div>}
      <div className="toolbar" style={{ justifyContent: "space-between", marginTop: 12, alignItems: "center" }}>
        <span className="small muted">{pending ? "Marvin denkt über dein Vorhaben nach und stellt erste Fragen …" : "Marvin stellt Rückfragen, recherchiert und legt den Plan an."}</span>
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Plane …" : "Gemeinsam planen"} <Icon name="arrowRight" size={16} />
        </button>
      </div>
    </form>
  );
}
