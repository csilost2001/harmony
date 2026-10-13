import { useEffect, useMemo, useState } from "react";
import { type SqlDialect, SQL_DIALECT_LABELS } from "../../utils/ddlGenerator";
import { alterToText, generateAlterDdl } from "../../utils/ddlAlter";
import { mcpBridge } from "../../mcp/mcpBridge";
import type { Table } from "../../types/v3";

interface FileVersion { id: string; savedAt: string; size: number }

interface Props {
  ddl: string;
  dialect: SqlDialect;
  onDialectChange: (d: SqlDialect) => void;
  /** 初期展開状態 (responsive 初期値を呼び出し側が計算して渡す) */
  defaultOpen?: boolean;
  /** 渡すと、「保存前の版との差分 (ALTER)」の表示に切り替えられる */
  diff?: { table: Table; allTables: Table[] };
}

const fmt = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ja-JP"); };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 読み込んだ結果は、何についてのものか (キー) と一緒に持つ。キーが変われば、古い結果は使わない (効果の中で、状態を消さない) */
interface Loaded<T> { key: string; value: T; error?: string }

export function DdlPreviewDrawer({ ddl, dialect, onDialectChange, defaultOpen = false, diff }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<"create" | "alter">("create");
  const [picked, setPicked] = useState("");
  const [versionsRes, setVersionsRes] = useState<Loaded<FileVersion[]> | null>(null);
  const [baseRes, setBaseRes] = useState<Loaded<Table | null> | null>(null);
  const tableId = diff?.table.id;

  // 差分に切り替えたとき、保存前の版の一覧を取る (新しい順)
  useEffect(() => {
    if (mode !== "alter" || !tableId) return;
    let cancelled = false;
    mcpBridge.request("fileVersions.list", { resourceType: "table", resourceId: tableId })
      .then((r) => { if (!cancelled) setVersionsRes({ key: tableId, value: (r as { versions?: FileVersion[] }).versions ?? [] }); })
      .catch((e) => { if (!cancelled) setVersionsRes({ key: tableId, value: [], error: errText(e) }); });
    return () => { cancelled = true; };
  }, [mode, tableId]);

  const vres = versionsRes && versionsRes.key === tableId ? versionsRes : null;
  const versions = vres ? vres.value : null;
  // 選んだ版 (一覧に無ければ、いちばん新しい版)
  const versionId = versions?.some((v) => v.id === picked) ? picked : versions?.[0]?.id ?? "";
  const baseKey = `${tableId}/${versionId}`;

  useEffect(() => {
    if (mode !== "alter" || !tableId || !versionId) return;
    let cancelled = false;
    mcpBridge.request("fileVersions.get", { resourceType: "table", resourceId: tableId, versionId })
      .then((r) => { if (!cancelled) setBaseRes({ key: baseKey, value: ((r as { snapshot?: Table }).snapshot ?? null) as Table | null }); })
      .catch((e) => { if (!cancelled) setBaseRes({ key: baseKey, value: null, error: errText(e) }); });
    return () => { cancelled = true; };
  }, [mode, tableId, versionId, baseKey]);

  const base = baseRes && baseRes.key === baseKey ? baseRes : null;
  const error = vres?.error ?? base?.error ?? null;

  const alterText = useMemo(() => {
    if (mode !== "alter" || !diff || !base?.value || !Array.isArray(base.value.columns)) return "";
    return alterToText(generateAlterDdl(base.value, diff.table, dialect, diff.allTables));
  }, [mode, diff, base, dialect]);

  const shown = mode === "alter" ? alterText : ddl;

  const handleCopy = () => {
    navigator.clipboard.writeText(shown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`ddl-drawer${open ? " ddl-drawer--open" : ""}`}>
      <div className="ddl-drawer-header" onClick={() => setOpen((v) => !v)}>
        <span className="ddl-drawer-title">
          <i className={`bi bi-chevron-${open ? "down" : "right"} ddl-drawer-chevron`} />
          <i className="bi bi-code-square" />
          DDL プレビュー
        </span>
        {open && (
          <div className="ddl-drawer-controls" onClick={(e) => e.stopPropagation()}>
            {diff && (
              <select value={mode} onChange={(e) => setMode(e.target.value as "create" | "alter")} className="ddl-dialect-select" aria-label="表示する DDL" data-testid="ddl-mode">
                <option value="create">テーブルの作成 (CREATE)</option>
                <option value="alter">保存前の版との差分 (ALTER)</option>
              </select>
            )}
            {mode === "alter" && (
              <select value={versionId} onChange={(e) => setPicked(e.target.value)} className="ddl-dialect-select" aria-label="比べる版" data-testid="ddl-version" disabled={!versions?.length}>
                {!versions?.length && <option value="">{versions === null ? "読み込み中…" : "保存前の版はありません"}</option>}
                {(versions ?? []).map((v) => <option key={v.id} value={v.id}>{fmt(v.savedAt)} の保存の前</option>)}
              </select>
            )}
            <select
              value={dialect}
              onChange={(e) => onDialectChange(e.target.value as SqlDialect)}
              className="ddl-dialect-select"
              aria-label="SQL の方言"
            >
              {Object.entries(SQL_DIALECT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{String(v)}</option>
              ))}
            </select>
            <button className="tbl-btn tbl-btn-ghost tbl-btn-sm" onClick={handleCopy} disabled={mode === "alter" && !alterText}>
              <i className={`bi ${copied ? "bi-check-lg" : "bi-clipboard"}`} />
              {copied ? "コピーしました" : "コピー"}
            </button>
          </div>
        )}
      </div>
      {open && (
        <div className="ddl-drawer-body">
          {mode === "alter" && error && <div className="ddl-diff-note" role="alert">版を読めませんでした: {error}</div>}
          {mode === "alter" && !error && versions !== null && versions.length === 0 && <div className="ddl-diff-note">この設計には、保存前の版がまだありません (保存すると、上書きされる前の内容が残ります)。</div>}
          {mode === "alter" && !error && base !== null && base.value === null && <div className="ddl-diff-note">選んだ版を読めませんでした。</div>}
          <pre className="ddl-preview" data-testid="ddl-text"><code>{shown}</code></pre>
        </div>
      )}
    </div>
  );
}
