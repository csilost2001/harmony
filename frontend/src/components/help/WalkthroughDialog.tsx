/** 通しの案内 (続編 第 10 弾 #199): 受注の例で、テーブル → 画面 → 画面項目 → 処理フロー → 点検 → 設計書。手順ごとに、開く画面・例・確かめ方を出し、終えた手順に印を付ける */
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { WALKTHROUGH_STEPS, WALKTHROUGH_TITLE, loadWalkthroughDone, nextStep, saveWalkthroughDone } from "../../utils/guidedWalkthrough";
import { reportFailure } from "../../utils/failureToast";
import { writeClipboardText } from "../../utils/tableExport";
import { showToast } from "../../utils/toast";
import "../../styles/pasteColumns.css";

export function WalkthroughDialog({ onClose }: { onClose: () => void }) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);
  const navigate = useNavigate();
  const { wsPath, wsId } = useWorkspacePath();
  const [done, setDone] = useState(() => loadWalkthroughDone(wsId));
  const next = nextStep(done);
  const [openId, setOpenId] = useState<string>(next?.id ?? WALKTHROUGH_STEPS[0].id);

  const toggle = (id: string) => setDone((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); saveWalkthroughDone(wsId, n); return n; });

  return (
    <div className="paste-cols-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div ref={trapRef} className="paste-cols-modal" style={{ width: "min(760px, 96vw)" }} role="dialog" aria-modal="true" aria-label="通しの案内" data-testid="walkthrough">
        <div className="paste-cols-head">
          <h2><i className="bi bi-signpost-split" /> {WALKTHROUGH_TITLE}</h2>
          <button type="button" className="paste-cols-close" aria-label="閉じる" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <div className="paste-cols-body">
          <p style={{ marginTop: 0, color: "var(--hm-fg-muted)" }}>受注の登録を題材に、設計の流れを 1 周します。{done.size} / {WALKTHROUGH_STEPS.length} 手順を終えました。手順の途中で閉じても、続きから再開できます。</p>
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {WALKTHROUGH_STEPS.map((s) => {
              const isDone = done.has(s.id);
              const isOpen = openId === s.id;
              return (
                <li key={s.id} data-testid={`wt-step-${s.id}`} data-done={isDone} style={{ border: "1px solid var(--hm-border)", borderRadius: 8, padding: "6px 10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="checkbox" checked={isDone} onChange={() => toggle(s.id)} aria-label={`${s.title} を終えた`} data-testid={`wt-done-${s.id}`} />
                    <button type="button" onClick={() => setOpenId(isOpen ? "" : s.id)} aria-expanded={isOpen} style={{ flex: 1, textAlign: "left", border: 0, background: "transparent", color: "inherit", font: "inherit", fontWeight: 600, cursor: "pointer", textDecoration: isDone ? "line-through" : "none" }} data-testid={`wt-open-${s.id}`}>{s.title}</button>
                    {next?.id === s.id && <span className="shortcut-help-here">次はここ</span>}
                  </div>
                  {isOpen && (
                    <div style={{ margin: "6px 0 4px 28px" }}>
                      <p style={{ margin: "0 0 6px" }}>{s.what}</p>
                      <ol style={{ margin: "0 0 8px", paddingLeft: 20 }}>{s.how.map((h, i) => <li key={i}>{h}</li>)}</ol>
                      {s.sample && (
                        <div style={{ margin: "0 0 8px" }}>
                          <small style={{ color: "var(--hm-fg-muted)" }}>{s.sample.label}</small>
                          <pre style={{ margin: "2px 0", padding: "6px 8px", background: "var(--hm-surface-2)", border: "1px solid var(--hm-border)", borderRadius: 6, overflow: "auto", fontSize: "0.82rem" }} data-testid={`wt-sample-${s.id}`}>{s.sample.text}</pre>
                          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => writeClipboardText(s.sample!.text).then(() => showToast("例をコピーしました")).catch((e) => reportFailure(e, "例のコピー"))} data-testid={`wt-copy-${s.id}`}><i className="bi bi-clipboard" /> 例をコピー</button>
                        </div>
                      )}
                      <p style={{ margin: "0 0 8px", color: "var(--hm-fg-muted)" }}><i className="bi bi-check2-square" /> できたか: {s.check}</p>
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => { onClose(); navigate(wsPath(s.route)); }} data-testid={`wt-go-${s.id}`}>{s.routeLabel}</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
