/**
 * 画面遷移の追加ダイアログ (キーボードで操作できる、線を引く代わり)。遷移元と遷移先の画面を選んで追加する。
 * 追加後の遷移の「ラベル・契機」は、線をダブルクリックして開く編集ダイアログと同じもので直せる。
 */
import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import "../../styles/pasteColumns.css";

interface Props {
  screens: ReadonlyArray<{ id: string; name: string }>;
  onAdd: (sourceId: string, targetId: string) => void;
  onClose: () => void;
}

export function AddTransitionDialog({ screens, onAdd, onClose }: Props) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);
  const [source, setSource] = useState(screens[0]?.id ?? "");
  const [target, setTarget] = useState(screens[1]?.id ?? screens[0]?.id ?? "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const options = screens.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>);
  return (
    <div className="paste-cols-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={trapRef} className="paste-cols-modal" role="dialog" aria-modal="true" aria-label="画面遷移の追加" data-testid="add-transition-dialog" style={{ width: "min(520px, calc(100vw - 32px))" }}>
        <div className="paste-cols-head">
          <h2><i className="bi bi-arrow-right-circle" /> 画面遷移を追加</h2>
          <button type="button" className="paste-cols-close" aria-label="閉じる" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <div className="paste-cols-body">
          <p className="paste-cols-help">画面から画面への線を、選んで追加します (線を引く代わりのキーボード操作です)。</p>
          <label className="tbl-field"><span>遷移元の画面</span>
            <select value={source} onChange={(e) => setSource(e.target.value)} autoFocus data-testid="add-transition-source">{options}</select>
          </label>
          <label className="tbl-field"><span>遷移先の画面</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)} data-testid="add-transition-target">{options}</select>
          </label>
        </div>
        <div className="paste-cols-foot">
          <button type="button" className="btn btn-sm btn-secondary" onClick={onClose}>キャンセル</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={!source || !target} data-testid="add-transition-apply"
            onClick={() => { onAdd(source, target); onClose(); }}>追加</button>
        </div>
      </div>
    </div>
  );
}
