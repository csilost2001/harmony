/**
 * ヘッダー右の利用者名。押すと名前を入力できる (他の人から見える編集中の表示名になる)。
 */
import { useEffect, useRef, useState } from "react";
import { setUserName, useUserName, USER_NAME_MAX } from "../../utils/userIdentity";

export function UserNameButton() {
  const name = useUserName();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const rootRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const commit = () => { setUserName(draft); setOpen(false); };

  return (
    <span className="common-header-user-wrap" ref={rootRef}>
      <button
        type="button"
        className="common-header-user"
        onClick={() => { setDraft(name); setOpen((v) => !v); }}
        title="名前を設定する (ほかの人から見える、編集中の表示名になります)"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="user-name-button"
      >
        <i className="bi bi-person-circle" />
        <span className="common-header-user-label">{name || "ゲスト"}</span>
      </button>
      {open && (
        <div className="common-header-user-pop" role="dialog" aria-label="利用者名の設定" data-testid="user-name-pop"
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
            if (e.key === "Enter") { e.preventDefault(); commit(); }
          }}>
          <label htmlFor="user-name-input">あなたの名前</label>
          <input id="user-name-input" ref={inputRef} data-testid="user-name-input" value={draft} maxLength={USER_NAME_MAX}
            placeholder="例: 山田 太郎" onChange={(e) => setDraft(e.target.value)} />
          <small>ほかの人から「{(draft.trim() || "ゲスト")} が編集中」のように見えます。このブラウザにだけ保存されます。</small>
          <div className="common-header-user-pop-actions">
            <button type="button" className="btn btn-sm btn-primary" onClick={commit} data-testid="user-name-save">保存</button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setOpen(false)}>閉じる</button>
          </div>
        </div>
      )}
    </span>
  );
}
