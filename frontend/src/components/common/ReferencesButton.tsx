/**
 * 「参照元」ボタンとダイアログ。その設計 (画面・テーブル・処理フローなど) を参照している設計を、
 * 種類ごとに一覧し、クリックで開く。改名・削除の前の影響確認、設計を辿る用。
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { mcpBridge } from "../../mcp/mcpBridge";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import {
  REFERRER_LABELS, groupReferrers, referrerRoute,
  type ReferenceResult, type ReferenceTargetType,
} from "../../utils/references";
import "../../styles/references.css";

interface Props {
  entityType: ReferenceTargetType;
  id: string;
  /** 表示名 (ダイアログの見出し用) */
  name?: string;
  className?: string;
  /** アイコンだけの小さなボタン (見出しの操作がアイコンだけのエディタ用) */
  compact?: boolean;
}

export function ReferencesButton({ entityType, id, name, className, compact }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className ?? (compact ? "editor-header-undo-btn" : "btn btn-sm btn-outline-secondary")}
        onClick={() => setOpen(true)} data-testid="references-open-btn" aria-label="参照元"
        title="参照元: この設計を参照している設計を一覧します (改名・削除の前の確認に)">
        <i className="bi bi-diagram-3" />{compact ? null : " 参照元"}
      </button>
      {open && <ReferencesDialog entityType={entityType} id={id} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ReferencesDialog({ entityType, id, name, onClose }: Props & { onClose: () => void }) {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const [result, setResult] = useState<ReferenceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    mcpBridge.request("findEntityReferences", { entityType, id })
      .then((r) => { if (!cancelled) setResult(r as ReferenceResult); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [entityType, id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const open = useCallback((route: string) => { onClose(); navigate(wsPath(route)); }, [navigate, wsPath, onClose]);
  const groups = result ? groupReferrers(result.referrers) : [];

  return (
    <div className="references-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="references-modal" role="dialog" aria-modal="true" aria-label="参照元" data-testid="references-dialog">
        <div className="references-head">
          <h2><i className="bi bi-diagram-3" /> 参照元 <code>{id}</code>{name && name !== id ? <span className="references-name">{name}</span> : null}</h2>
          <button type="button" className="references-close" aria-label="閉じる" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <div className="references-body">
          {error && <p className="references-error" role="alert">調べられませんでした: {error}</p>}
          {!error && !result && <p className="references-muted">調べています…</p>}
          {result && groups.length === 0 && (
            <p className="references-muted" data-testid="references-empty">この設計を参照している設計は見つかりません。</p>
          )}
          {result && groups.length > 0 && (
            <>
              <p className="references-summary" data-testid="references-summary">
                {result.referrers.length} 件の設計から {result.total} か所で参照されています。改名すると、これらの参照も追従して書き換わります。削除すると、これらは参照先を失います。
              </p>
              {groups.map((g) => (
                <section key={g.kind} className="references-group">
                  <h3>{REFERRER_LABELS[g.kind]} <span className="references-count">{g.items.length}</span></h3>
                  <ul>
                    {g.items.map((r) => {
                      const route = referrerRoute(r);
                      return (
                        <li key={`${r.kind}:${r.id}`}>
                          {route
                            ? <button type="button" className="references-link" onClick={() => open(route)} data-testid={`references-item-${r.kind}-${r.id}`}>
                                {r.name ?? r.id}{r.name && r.name !== r.id ? <code>{r.id}</code> : null}
                              </button>
                            : <span>{r.name ?? r.id}{r.name && r.name !== r.id ? <code>{r.id}</code> : null}</span>}
                          <span className="references-n">{r.count} か所</span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
