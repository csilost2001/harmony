/** 設計の分析の画面の共通部品: 表・設計へのリンク・ファイルの保存 */
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { DocIssueRef } from "@harmony/shared";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { referrerRoute } from "../../utils/references";

/** 設計を開くリンク (開く先が無い種類は、ただの文字) */
export function EntityLink({ kind, id, children }: { kind: DocIssueRef["kind"] | string; id: string; children?: ReactNode }) {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const route = referrerRoute({ kind: kind as never, id });
  if (!route) return <>{children ?? id}</>;
  return <button type="button" className="an-link" onClick={() => navigate(wsPath(route))} title="この設計を開く">{children ?? id}</button>;
}

export function Section({ title, hint, actions, children, testId }: { title: string; hint?: ReactNode; actions?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="an-section" data-testid={testId}>
      <header className="an-section-head">
        <h2>{title}</h2>
        {hint && <span className="an-hint">{hint}</span>}
        <span className="an-spacer" />
        {actions}
      </header>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="an-empty">{children}</p>;
}

/** 表。行が多いときは、最初の `limit` 行だけを出して「もっと見る」で広げる */
export function AnTable({ headers, rows, limit = 200, testId, empty = "該当するものはありません。" }: { headers: string[]; rows: ReactNode[][]; limit?: number; testId?: string; empty?: string }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return <Empty>{empty}</Empty>;
  const shown = all ? rows : rows.slice(0, limit);
  return (
    <div className="an-table-wrap" data-testid={testId}>
      <table className="an-table">
        <thead><tr>{headers.map((h, i) => <th key={`${h}${i}`} scope="col">{h || <span className="an-sr">操作</span>}</th>)}</tr></thead>
        <tbody>{shown.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
      {rows.length > shown.length && <button type="button" className="an-btn" onClick={() => setAll(true)}>残り {rows.length - shown.length} 件も表示</button>}
    </div>
  );
}

export function SeverityBadge({ severity }: { severity: "error" | "warning" | "info" }) {
  const label = { error: "エラー", warning: "警告", info: "情報" }[severity];
  return <span className={`an-sev an-sev-${severity}`}>{label}</span>;
}
