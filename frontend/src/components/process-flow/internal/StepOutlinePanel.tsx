/**
 * 処理フローの目次 (UI 改善提案 第 5 弾 #90)。工程が多い処理フローで、全体の構造 (分岐・繰り返しの入れ子) を見渡し、クリック / Enter で該当の工程へ移る。
 * 画面の中央に見えている工程は強調する。文字で絞り込める。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Step } from "../../../types/v3";
import { buildStepOutline, filterOutline } from "../../../utils/stepOutline";
import { normalizeForMatch } from "../../../utils/textMatch";
import { findDeepLinkElement } from "../../../utils/deepLink";
import { focusIssue } from "../../../utils/pageIssues";

export function StepOutlinePanel({ steps, selectedIds }: { steps: readonly Step[]; selectedIds: ReadonlySet<string> }) {
  const [query, setQuery] = useState("");
  const [visibleId, setVisibleId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const items = useMemo(() => buildStepOutline(steps), [steps]);
  const shown = useMemo(() => filterOutline(items, query, normalizeForMatch), [items, query]);

  // いま画面に見えている (いちばん上の) 工程を強調する
  useEffect(() => {
    const root = document.getElementById("app-main");
    if (!root || typeof IntersectionObserver === "undefined") return;
    const seen = new Map<string, number>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const key = (e.target as HTMLElement).dataset.deeplink?.slice(5) ?? "";
        if (e.isIntersecting) seen.set(key, e.boundingClientRect.top); else seen.delete(key);
      }
      const top = [...seen.entries()].sort((a, b) => a[1] - b[1])[0];
      setVisibleId(top ? top[0] : null);
    }, { threshold: 0.15 });
    const targets = root.querySelectorAll<HTMLElement>('.step-card-wrapper[data-deeplink^="step:"]');
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, [items]);

  const jump = (id: string) => {
    const root = document.getElementById("app-main");
    const el = root ? findDeepLinkElement(root, { kind: "step", id }) : null;
    if (el) focusIssue(el);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const btns = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button.step-outline-item") ?? []);
    const i = btns.findIndex((b) => b === document.activeElement);
    const next = btns[Math.min(Math.max(i + (e.key === "ArrowDown" ? 1 : -1), 0), btns.length - 1)];
    if (next) { e.preventDefault(); next.focus(); }
  };

  return (
    <div className="step-outline" data-testid="step-outline">
      <div className="process-flow-palette-search">
        <i className="bi bi-search" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="目次を絞り込む" aria-label="目次を絞り込む" />
      </div>
      {items.length === 0 ? <div className="process-flow-palette-empty">工程がありません</div> : (
        <ul ref={listRef} className="step-outline-list" onKeyDown={onKeyDown} aria-label="工程の目次">
          {shown.map((it) => (
            <li key={it.id}>
              {it.group && !query && <div className="step-outline-group" style={{ paddingLeft: 8 + it.depth * 12 }}>{it.group}</div>}
              <button
                type="button"
                className={`step-outline-item${selectedIds.has(it.id) ? " is-selected" : ""}${visibleId === it.id ? " is-visible" : ""}`}
                style={{ paddingLeft: 8 + it.depth * 12 }}
                onClick={() => jump(it.id)}
                title={`${it.number} ${it.typeLabel}${it.text ? ` — ${it.text}` : ""}`}
                data-testid={`step-outline-item-${it.id}`}
              >
                <span className="step-outline-no">{it.number}</span>
                <span className="step-outline-type">{it.typeLabel}</span>
                {it.text && <span className="step-outline-text">{it.text}</span>}
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="process-flow-palette-empty">該当する工程がありません</li>}
        </ul>
      )}
    </div>
  );
}
