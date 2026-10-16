/** 個人メモ (#173): この設計についての、自分だけのメモ。原本には書かず、このブラウザにだけ残す。「今日」の印で、ダッシュボードの今日やることに出す */
import { useState } from "react";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { loadNotes, MAX_NOTE_CHARS, noteRef, saveNote } from "../../utils/personalNotes";
import { showToast } from "../../utils/toast";
import type { TabDesign } from "../../utils/designHistory";
import { formatTime } from "../operations/reviewUtils";

export function HistoryMemoTab({ design, label }: { design: TabDesign; label: string }) {
  const { wsId } = useWorkspacePath();
  const ref = noteRef(design.kind, design.id);
  const saved = loadNotes(wsId)[ref];
  const [text, setText] = useState(saved?.text ?? "");
  const [today, setToday] = useState(saved?.today ?? false);
  const [savedAt, setSavedAt] = useState(saved?.at ?? "");
  const dirty = text !== (saved?.text ?? "") || today !== (saved?.today ?? false);
  const save = () => {
    const r = saveNote(wsId, ref, text, today);
    if (!r.ok) { showToast("メモを残せませんでした (件数の上限か、ブラウザの保存領域の不足です)", "error"); return; }
    setSavedAt(r.notes[ref]?.at ?? "");
    showToast(text.trim() ? `「${label}」のメモを保存しました` : "メモを消しました");
    window.dispatchEvent(new Event("harmony:notes-changed"));
  };
  return (
    <div data-testid="dh-memo">
      <textarea className="an-input dh-memo-text" rows={8} value={text} maxLength={MAX_NOTE_CHARS} onChange={(e) => setText(e.target.value)} placeholder="例: 桁数は、顧客に確認してから決める" aria-label="個人メモ" data-testid="dh-memo-text" />
      <div className="dh-copy-row">
        <label className="dh-inline"><input type="checkbox" checked={today} onChange={(e) => setToday(e.target.checked)} data-testid="dh-memo-today" /> 今日やることに出す</label>
        <button type="button" className="an-btn primary" disabled={!dirty} onClick={save} data-testid="dh-memo-save">{text.trim() ? "メモを保存" : saved ? "メモを消す" : "メモを保存"}</button>
        {savedAt && <small className="an-hint">最後の保存: {formatTime(savedAt)}</small>}
      </div>
      <p className="an-hint">このメモは、自分のブラウザにだけ残ります。設計の原本・マーカー・ほかの人の画面には出ません。ブラウザの保存領域を消すと、メモも消えます。</p>
    </div>
  );
}
