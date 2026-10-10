/**
 * はじめかたパネル。設計がまだ少ないプロジェクトで、何から作ればよいかを示す (できた項目に印が付く)。
 * すべて始めていれば、短い案内 (Ctrl+K・AI への依頼) だけになる。
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../../hooks/useWorkspacePath";
import { mcpBridge } from "../../../mcp/mcpBridge";
import { loadProject } from "../../../store/flowStore";
import { listBusinessFlows } from "../../../store/businessFlowStore";
import { listReports } from "../../../store/reportStore";

interface Counts { screens: number; tables: number; flows: number; businessFlows: number; reports: number }

const STEPS: Array<{ key: keyof Counts; label: string; hint: string; route: string; icon: string }> = [
  { key: "screens", label: "画面を作る", hint: "入力フォーム・一覧表などの部品を並べて、画面を組み立てます", route: "/screen/list", icon: "bi-window" },
  { key: "tables", label: "テーブルを定義する", hint: "画面や処理が使うデータの置き場所と列を決めます", route: "/table/list", icon: "bi-table" },
  { key: "flows", label: "処理フローを書く", hint: "ボタンを押したときの処理を、入力チェック・DB アクセスなどの手順で書きます", route: "/process-flow/list", icon: "bi-lightning" },
  { key: "businessFlows", label: "業務フローを描く", hint: "誰が何をするかを、レーンと工程でつなぎます (任意)", route: "/business-flow/list", icon: "bi-diagram-2" },
  { key: "reports", label: "帳票を設計する", hint: "納品書・一覧表などの出力を、部と項目で決めます (任意)", route: "/report/list", icon: "bi-file-earmark-text" },
];

const RELOAD_EVENTS = ["projectChanged", "screenChanged", "screenItemsChanged", "tableChanged", "processFlowChanged", "businessFlowChanged", "reportChanged"] as const;

export function GettingStartedPanel() {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = async () => {
      const [p, bf, rp] = await Promise.allSettled([loadProject(), listBusinessFlows(), listReports()]);
      if (cancelled) return;
      const project = p.status === "fulfilled" ? p.value : null;
      setCounts({
        screens: project?.screens?.length ?? 0, // 「機能別定義数」と同じ数 (ガジェット用の画面も含む)
        tables: project?.tables?.length ?? 0,
        flows: project?.processFlows?.length ?? 0,
        businessFlows: bf.status === "fulfilled" ? bf.value.length : 0,
        reports: rp.status === "fulfilled" ? rp.value.length : 0,
      });
    };
    const later = () => { clearTimeout(timer); timer = setTimeout(reload, 400); };
    reload();
    const unsubs = RELOAD_EVENTS.map((ev) => mcpBridge.onBroadcast(ev, later));
    const unsubStatus = mcpBridge.onStatusChange((s) => { if (s === "connected") later(); });
    return () => { cancelled = true; clearTimeout(timer); unsubs.forEach((u) => u()); unsubStatus(); };
  }, []);

  if (!counts) return <div style={{ padding: 8, color: "var(--hm-fg-muted)" }}>読み込み中…</div>;
  const doneCount = STEPS.filter((s) => counts[s.key] > 0).length;
  const empty = doneCount === 0;

  return (
    <div className="gsp" data-testid="getting-started-panel">
      <p className="gsp-lead">
        {empty
          ? "このプロジェクトには、まだ設計がありません。次の順に作ると、設計書 (HTML) が自動で組み上がります。"
          : `設計を始めた項目: ${doneCount} / ${STEPS.length}`}
      </p>
      <ol className="gsp-steps">
        {STEPS.map((s) => {
          const n = counts[s.key];
          return (
            <li key={s.key} className={n > 0 ? "done" : ""} data-testid={`gsp-step-${s.key}`}>
              <i className={`bi ${n > 0 ? "bi-check-circle-fill" : s.icon} gsp-mark`} />
              <span className="gsp-text"><b>{s.label}</b>{n > 0 ? <small> {n} 件</small> : <small> {s.hint}</small>}</span>
              <button type="button" className="gsp-go" onClick={() => navigate(wsPath(s.route))}>{n > 0 ? "開く" : "はじめる"}</button>
            </li>
          );
        })}
      </ol>
      <p className="gsp-tips">
        <i className="bi bi-search" /> <kbd>Ctrl</kbd>+<kbd>K</kbd> で、画面・テーブル・処理フローなどへすぐ移れます。
        <br /><i className="bi bi-robot" /> AI (MCP) につないでいれば、「注文管理の画面とテーブルを作って」のように頼めます。
      </p>
    </div>
  );
}
