import { MarvinIcon } from "./Marvin";
import { ApprovalCard } from "./ApprovalCard";
import { Icon } from "./Icon";
import type { ChatItem } from "@/lib/marvin/view";

export function MarvinThread({ items, accountEmails }: { items: ChatItem[]; accountEmails: Record<string, string> }) {
  return (
    <>
      {items.map((it) => {
        switch (it.kind) {
          case "user":
            return (
              <div key={it.key} className="msg user">
                <div className="bubble">{it.text}</div>
              </div>
            );
          case "assistant":
            return (
              <div key={it.key} className="msg assistant">
                <MarvinIcon size={36} />
                <div className="bubble">{it.text}</div>
              </div>
            );
          case "tools":
            return (
              <div key={it.key} className="tool-chips">
                {it.labels.map((l, i) => (
                  <span key={i} className="badge badge-green">
                    <Icon name="check" size={12} /> {l}
                  </span>
                ))}
              </div>
            );
          case "sources":
            return (
              <div key={it.key} className="sources">
                <span className="eyebrow">Quellen</span>
                {it.sources.map((s) => (
                  <a key={s.url} href={s.url} target="_blank" rel="noreferrer noopener">
                    <Icon name="globe" size={12} /> {s.title}
                  </a>
                ))}
              </div>
            );
          case "approval":
            return <ApprovalCard key={it.key} approval={it.approval} accountEmail={it.approval.accountId ? accountEmails[it.approval.accountId] : undefined} />;
          case "note":
            return (
              <div key={it.key} className="small muted" style={{ textAlign: "center" }}>
                {it.text}
              </div>
            );
        }
      })}
    </>
  );
}
