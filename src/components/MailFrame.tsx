"use client";

import { useRef } from "react";

/**
 * Zeigt HTML-Mails isoliert an: kein JavaScript (sandbox ohne allow-scripts),
 * externe Inhalte (Tracking-Pixel) per CSP blockiert, solange der Nutzer sie nicht freigibt.
 */
export function MailFrame({ html, allowRemote }: { html: string; allowRemote: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const csp = `default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data: cid:${allowRemote ? " https: http:" : ""};`;
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>body{margin:0;font-family:Inter,system-ui,sans-serif;font-size:14px;color:#1b2433;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>${html}</body></html>`;
  const resize = () => {
    const el = ref.current;
    const body = el?.contentDocument?.body;
    if (el && body) el.style.height = `${Math.min(body.scrollHeight + 16, 4000)}px`;
  };
  return (
    <iframe
      ref={ref}
      className="mail-frame"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      onLoad={resize}
      title="E-Mail-Inhalt"
    />
  );
}
