/** 「新しくなったこと」(続編 第 10 弾 #190): 更新のあとの最初に、新しいリリースノートを 5 件までに絞って見せる。閉じれば、同じものは出ない */
import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import type { ReleaseNoteLike } from "../../utils/updateNotice";
import "../../styles/pasteColumns.css";

export function WhatsNewDialog({ notes, total, onClose }: { notes: ReleaseNoteLike[]; total: number; onClose: () => void }) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  return (
    <div className="paste-cols-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div ref={trapRef} className="paste-cols-modal" style={{ width: "min(560px, 96vw)" }} role="dialog" aria-modal="true" aria-label="新しくなったこと" data-testid="whats-new">
        <div className="paste-cols-head">
          <h2><i className="bi bi-stars" /> 新しくなったこと</h2>
          <button type="button" className="paste-cols-close" aria-label="閉じる" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <div className="paste-cols-body">
          <ul style={{ margin: 0, paddingLeft: 20 }} data-testid="whats-new-list">
            {notes.map((n, i) => <li key={`${n.date}:${i}`}><small style={{ color: "var(--hm-fg-muted)" }}>{n.date}</small> {n.title}{n.pr ? <small style={{ color: "var(--hm-fg-muted)" }}> #{n.pr}</small> : null}</li>)}
          </ul>
          {total > notes.length && <p style={{ color: "var(--hm-fg-muted)", fontSize: "0.85rem" }}>ほかの変更は、リリースノートで見られます (全 {total} 件)。</p>}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "8px 16px 14px" }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { onClose(); navigate(wsPath("/operations")); }} data-testid="whats-new-notes">リリースノート (連携と運用) を開く</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose} data-testid="whats-new-close">閉じる</button>
        </div>
      </div>
    </div>
  );
}
