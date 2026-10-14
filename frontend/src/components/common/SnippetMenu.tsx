/**
 * スニペットのメニュー。選んだカラム・画面項目・工程を、名前をつけて残し、あとで (別のテーブル・画面・処理フローにも) 挿入する。
 * 保存先はこのブラウザ (ワークスペースごと)。ほかの人へは、JSON の書き出し / 読み込みで渡す。
 */
import { useEffect, useRef, useState } from "react";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import {
  SNIPPET_KIND_LABELS, SNIPPET_UNIT, addSnippet, exportSnippets, importSnippets, removeSnippet, useSnippets,
  type Snippet, type SnippetKind,
} from "../../utils/snippets";
import { saveTextFile } from "../analysis/fileIo";
import { showToast } from "../../utils/toast";
import "../../styles/snippets.css";

interface Props {
  kind: SnippetKind;
  /** いま選んでいる中身 (保存するもの)。選んでいなければ空 */
  getSelection: () => unknown[];
  selectionCount: number;
  /** スニペットの中身を挿入する (元の JSON の複製が渡る。ID の付け直しは、挿入する側が行う) */
  onInsert: (snippet: Snippet) => void;
  /** 閲覧のみのときは、挿入できない (保存はできる) */
  readonly?: boolean;
  className?: string;
  /** メニューを開く向き (左端のサイドバーに置くときは left) */
  popAlign?: "left" | "right";
}

export function SnippetMenu({ kind, getSelection, selectionCount, onInsert, readonly, className = "tbl-btn tbl-btn-ghost tbl-btn-sm", popAlign = "right" }: Props) {
  const { wsId } = useWorkspacePath();
  const all = useSnippets(wsId);
  const list = all.filter((s) => s.kind === kind);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLSpanElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const unit = SNIPPET_UNIT[kind];
  const save = () => {
    const r = addSnippet(wsId, kind, name, getSelection());
    if (!r.ok) { setError(r.reason); return; }
    setName(""); setError("");
    showToast(`スニペット「${r.snippet.name}」を保存しました`);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const r = importSnippets(wsId, text);
    if (r.error) showToast(`読み込めませんでした: ${r.error}`, "error");
    else showToast(`スニペットを ${r.added} 件読み込みました${r.skipped > 0 ? ` (${r.skipped} 件は、形が違う・同じ名前があるため飛ばしました)` : ""}`, "info");
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <span className="snip-wrap" ref={rootRef}>
      <button type="button" className={className} data-testid="snippet-open" aria-haspopup="dialog" aria-expanded={open}
        title={`よく使う${SNIPPET_KIND_LABELS[kind]}の並びを、名前をつけて残して、あとで挿入します`} onClick={() => setOpen((v) => !v)}>
        <i className="bi bi-bookmark-plus" /> スニペット{list.length > 0 ? ` (${list.length})` : ""}
      </button>
      {open && (
        <div className={`snip-pop${popAlign === "left" ? " snip-pop--left" : ""}`} role="dialog" aria-label={`${SNIPPET_KIND_LABELS[kind]}のスニペット`} data-testid="snippet-pop"
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}>
          <div className="snip-save">
            <strong>選んだ {selectionCount} {unit}を保存</strong>
            <div className="snip-save-row">
              <input type="text" value={name} placeholder="例: 監査用の列" aria-label="スニペットの名前" maxLength={60} disabled={selectionCount === 0}
                onChange={(e) => { setName(e.target.value); setError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); save(); } }} data-testid="snippet-name" />
              <button type="button" className="snip-btn is-primary" disabled={selectionCount === 0 || !name.trim()} onClick={save} data-testid="snippet-save">保存</button>
            </div>
            {selectionCount === 0 && <small>保存するには、先に {unit} を選んでください。</small>}
            {error && <small className="snip-error" role="alert" data-testid="snippet-error">{error}</small>}
          </div>
          {list.length === 0 ? (
            <p className="snip-empty">保存したスニペットはまだありません。</p>
          ) : (
            <ul className="snip-list">
              {list.map((s) => (
                <li key={s.id} className="snip-item" data-testid="snippet-item">
                  <span className="snip-name" title={s.name}>{s.name}</span>
                  <span className="snip-count">{s.items.length} {unit}</span>
                  <button type="button" className="snip-btn" disabled={readonly} title={readonly ? "編集モードにしてから挿入できます" : "いまの位置に挿入"} onClick={() => { setOpen(false); onInsert({ ...s, items: JSON.parse(JSON.stringify(s.items)) as Snippet["items"] }); }} data-testid="snippet-insert">挿入</button>
                  <button type="button" className="snip-btn is-danger" aria-label={`スニペット「${s.name}」を削除`} title="削除" onClick={() => removeSnippet(wsId, s.id)}><i className="bi bi-trash" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="snip-foot">
            <button type="button" className="snip-link" disabled={all.length === 0} onClick={() => saveTextFile("harmony-snippets.json", exportSnippets(wsId), "application/json")} data-testid="snippet-export">書き出し (JSON)</button>
            <button type="button" className="snip-link" onClick={() => fileRef.current?.click()} data-testid="snippet-import">読み込み</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { void onFile(e.target.files?.[0]); }} aria-label="スニペットのファイルを選ぶ" />
          </div>
          <small className="snip-note">このブラウザにだけ保存されます。ほかの人へは、書き出したファイルを渡してください。</small>
        </div>
      )}
    </span>
  );
}
