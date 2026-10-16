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
import { issueStepExpand } from "../../../store/stepExpand";
import { VARIABLE_ORIGIN_LABELS, type VariableInfo } from "../../../utils/stepVariables";

export function StepOutlinePanel({ steps, selectedIds, variables = [] }: { steps: readonly Step[]; selectedIds: ReadonlySet<string>; variables?: readonly VariableInfo[] }) {
  const [query, setQuery] = useState("");
  const [visibleId, setVisibleId] = useState<string | null>(null);
  // 変数を選ぶと、その変数を定義する工程・使う工程を、画面の工程カードで強調する (続編 第 8 弾 #146)
  const [pickedVar, setPickedVar] = useState<string | null>(null);
  const picked = variables.find((v) => v.name === pickedVar) ?? null;
  useEffect(() => {
    const root = document.getElementById("app-main");
    if (!root) return;
    root.querySelectorAll("[data-var-hit]").forEach((el) => el.removeAttribute("data-var-hit"));
    if (!picked) return;
    const mark = (id: string, kind: "define" | "use") => root.querySelector(`.step-card[data-step-id="${CSS.escape(id)}"]`)?.closest(".step-card-wrapper")?.setAttribute("data-var-hit", kind);
    for (const u of picked.uses) mark(u, "use");
    if (picked.definedAt) mark(picked.definedAt, "define");
    return () => { root.querySelectorAll("[data-var-hit]").forEach((el) => el.removeAttribute("data-var-hit")); };
  }, [picked, steps]);
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
      <div className="step-outline-expand" role="group" aria-label="工程カードの開閉">
        <button type="button" onClick={() => issueStepExpand("collapse")} title="すべての工程カードを畳む" data-testid="steps-collapse-all"><i className="bi bi-chevron-bar-contract" /> すべて畳む</button>
        <button type="button" onClick={() => issueStepExpand("expand")} title="すべての工程カードを開く" data-testid="steps-expand-all"><i className="bi bi-chevron-bar-expand" /> すべて開く</button>
        <button type="button" onClick={() => issueStepExpand("attention")} title="要確認・マーカーのある工程だけ開く (ほかは畳む)" data-testid="steps-expand-attention"><i className="bi bi-exclamation-triangle" /> 要確認だけ</button>
      </div>
      <div className="process-flow-palette-search">
        <i className="bi bi-search" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="目次を検索" aria-label="目次を絞り込む" />
      </div>
      {variables.length > 0 && (
        <details className="step-outline-vars" data-testid="step-outline-vars">
          <summary>変数 ({variables.length})</summary>
          <ul>
            {variables.map((v) => (
              <li key={v.name}>
                <button type="button" className={`step-outline-var${pickedVar === v.name ? " is-picked" : ""}${v.uses.length === 0 ? " is-unused" : ""}`} aria-pressed={pickedVar === v.name}
                  onClick={() => { const next = pickedVar === v.name ? null : v.name; setPickedVar(next); const first = v.uses[0] ?? v.definedAt; if (next && first) jump(first); }}
                  title={`${VARIABLE_ORIGIN_LABELS[v.origin]}${v.label ? ` (${v.label})` : ""}。使っている工程: ${v.uses.length} 件${v.definedAt ? "。定義している工程あり" : ""}`}
                  data-testid={`step-var-${v.name}`}>
                  <code>@{v.name}</code>
                  <span className="step-outline-var-n">{v.uses.length === 0 ? "未使用" : `${v.uses.length} 工程`}</span>
                </button>
              </li>
            ))}
          </ul>
          {picked && <div className="step-outline-var-note">強調中: 定義 (緑の線) と、使っている工程 (黄色の線)。もう一度押すと外れます</div>}
        </details>
      )}
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
