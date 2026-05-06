import { useState } from "react";
import { type SqlDialect, SQL_DIALECT_LABELS } from "../../utils/ddlGenerator";

interface Props {
  ddl: string;
  dialect: SqlDialect;
  onDialectChange: (d: SqlDialect) => void;
  /** 初期展開状態 (responsive 初期値を呼び出し側が計算して渡す) */
  defaultOpen?: boolean;
}

export function DdlPreviewDrawer({ ddl, dialect, onDialectChange, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(ddl);
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
            <select
              value={dialect}
              onChange={(e) => onDialectChange(e.target.value as SqlDialect)}
              className="ddl-dialect-select"
            >
              {Object.entries(SQL_DIALECT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{String(v)}</option>
              ))}
            </select>
            <button className="tbl-btn tbl-btn-ghost tbl-btn-sm" onClick={handleCopy}>
              <i className={`bi ${copied ? "bi-check-lg" : "bi-clipboard"}`} />
              {copied ? "コピーしました" : "コピー"}
            </button>
          </div>
        )}
      </div>
      {open && (
        <div className="ddl-drawer-body">
          <pre className="ddl-preview"><code>{ddl}</code></pre>
        </div>
      )}
    </div>
  );
}
