/**
 * 設計書ビュー。ワークスペースの設計データ (画面 / 処理フロー / テーブル / 規約) から
 * 基本設計書・処理設計書を組み立てて表示し、HTML ファイルとして保存できるようにする。
 * 生成は @harmony/shared の buildDesignDocument (CLI の scripts/export-design-doc.mjs と共通)。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { buildDesignDocument, renderStandaloneDesignDoc, type DesignDocInput } from "@harmony/shared";
import { mcpBridge } from "../../mcp/mcpBridge";
import { loadDesignInput } from "./loadDesignInput";
import "../../styles/designDocument.css";

export function DesignDocumentView() {
  const [input, setInput] = useState<DesignDocInput | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(() => {
    setLoading(true);
    loadDesignInput()
      .then((r) => { setInput(r.input); setSkipped(r.skipped); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    mcpBridge.startWithoutEditor();
    reload();
    return mcpBridge.onStatusChange((s) => { if (s === "connected") reload(); });
  }, [reload]);

  const doc = useMemo(() => (input ? buildDesignDocument(input) : null), [input]);
  const counts = useMemo(() => ({
    error: doc?.issues.filter((i) => i.severity === "error").length ?? 0,
    warning: doc?.issues.filter((i) => i.severity === "warning").length ?? 0,
    info: doc?.issues.filter((i) => i.severity === "info").length ?? 0,
  }), [doc]);

  const scrollTo = useCallback((id: string) => {
    const el = bodyRef.current?.querySelector(`#${CSS.escape(id)}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // 本文内のページ内リンクは URL を変えずに本文をスクロールする
  const onBodyClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (href?.startsWith("#")) { e.preventDefault(); scrollTo(href.slice(1)); }
  };

  const standalone = useCallback(() => (input ? renderStandaloneDesignDoc({ ...input, generatedAt: new Date().toISOString() }) : ""), [input]);

  const saveHtml = () => {
    if (!input) return;
    const blob = new Blob([standalone()], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // 日本語のファイル名はブラウザによって無視され "download" になるため、英数字のプロジェクト ID を使う
    a.download = `${(input.project.id ?? "").replace(/[^A-Za-z0-9_-]+/g, "") || "harmony"}-design-document.html`;
    // 文書に入っていないリンクでは download 属性 (ファイル名) が無視されるブラウザがあるため一時的に追加する
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const openInNewTab = () => {
    if (!input) return;
    const url = URL.createObjectURL(new Blob([standalone()], { type: "text/html;charset=utf-8" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div className="ddv-root" data-testid="design-document-view">
      <header className="ddv-toolbar">
        <h1 className="ddv-title"><i className="bi bi-journal-text" /> 設計書</h1>
        <span className="ddv-sub">画面・処理フロー・テーブル・規約の設計データから生成した基本設計書 / 処理設計書です。</span>
        <span className="ddv-spacer" />
        {doc && (
          <button type="button" className={`ddv-issues${counts.error ? " has-error" : counts.warning ? " has-warning" : ""}`} onClick={() => scrollTo("issues")} data-testid="ddv-issues">
            <i className="bi bi-clipboard-check" /> 要確認 {counts.error + counts.warning} 件{counts.info > 0 && <small className="ddv-issues-info"> (情報 {counts.info})</small>}
          </button>
        )}
        <button type="button" className="ddv-btn" onClick={reload} disabled={loading} title="最新の設計データで作り直す"><i className="bi bi-arrow-clockwise" /> 再生成</button>
        <button type="button" className="ddv-btn" onClick={openInNewTab} disabled={!doc} title="別タブで開く (印刷はこちらから)"><i className="bi bi-box-arrow-up-right" /> 別タブで開く</button>
        <button type="button" className="ddv-btn primary" onClick={saveHtml} disabled={!doc} data-testid="ddv-save-html"><i className="bi bi-download" /> HTML で保存</button>
      </header>
      {skipped.length > 0 && (
        <p className="ddv-skipped" role="alert" data-testid="ddv-skipped">
          <i className="bi bi-exclamation-triangle" /> 読めないものがあるため、設計書に載っていません (JSON が壊れている・読み込みに失敗した): {skipped.map((f) => <code key={f}>{f}</code>)}
        </p>
      )}
      {error ? (
        <div className="ddv-message">設計データを読み込めませんでした: {error}</div>
      ) : !doc ? (
        <div className="ddv-message">設計書を作成しています…</div>
      ) : (
        <div className="ddv-body">
          <nav className="ddv-toc" aria-label="目次">
            {doc.toc.map((t) => (
              <button key={t.id} type="button" className={`ddv-toc-${t.level}`} onClick={() => scrollTo(t.id)}>{t.title}</button>
            ))}
          </nav>
          <div className="ddv-page" ref={bodyRef} onClick={onBodyClick} data-theme-audit-skip>
            <style>{doc.css}</style>
            <div dangerouslySetInnerHTML={{ __html: doc.html }} />
          </div>
        </div>
      )}
    </div>
  );
}
