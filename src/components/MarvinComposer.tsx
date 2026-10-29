"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { marvinSendAction, type ActionState } from "@/app/(app)/actions";
import { Icon } from "./Icon";

export function MarvinComposer({
  conversationId,
  projectId,
  initialText = "",
  placeholder = "Schreib Marvin, was du erreichen möchtest …",
}: {
  conversationId?: string;
  projectId?: string;
  initialText?: string;
  placeholder?: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(marvinSendAction, null);
  const [text, setText] = useState(initialText);
  const [sent, setSent] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!pending) setSent("");
  }, [pending]);

  return (
    <>
      {pending && (
        <div style={{ padding: "0 22px 12px" }}>
          {sent && (
            <div className="msg user" style={{ marginBottom: 12 }}>
              <div className="bubble">{sent}</div>
            </div>
          )}
          <div className="thinking">
            <Image src="/brand/marvin-icon.webp" alt="" width={30} height={30} />
            Marvin arbeitet daran …
          </div>
        </div>
      )}
      {state?.error && (
        <div className="notice error" style={{ margin: "0 22px 12px" }}>
          {state.error}
        </div>
      )}
      <form
        ref={formRef}
        action={(fd) => {
          setSent(String(fd.get("text") ?? ""));
          setText("");
          action(fd);
        }}
        className="composer"
      >
        {conversationId && <input type="hidden" name="conversationId" value={conversationId} />}
        {projectId && <input type="hidden" name="projectId" value={projectId} />}
        <textarea
          name="text"
          className="textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          rows={2}
          disabled={pending}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (text.trim()) formRef.current?.requestSubmit();
            }
          }}
          aria-label="Nachricht an Marvin"
        />
        <button className="btn btn-primary" disabled={pending || !text.trim()} aria-label="Senden">
          <Icon name="send" size={16} />
        </button>
      </form>
    </>
  );
}
