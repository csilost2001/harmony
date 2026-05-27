// #1388 sub-section A (Option 2 部分): Designer.tsx 末尾に inline 定義されていた
// LegacyRescueDialog を独立ファイル化 (DesignerDialogs.tsx から import 可能にする)。
// 機能変更なし、Designer.tsx からそのまま move したのみ。
import { useEffect, useRef } from "react";

export interface LegacyRescueDialogProps {
  onAdopt: () => void;
  onDiscard: () => void;
}

export function LegacyRescueDialog({ onAdopt, onDiscard }: LegacyRescueDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDiscard();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onDiscard]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="edit-mode-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onDiscard(); }}
      role="presentation"
    >
      <div
        className="edit-mode-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legacy-rescue-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="edit-mode-modal-header">
          <h5 id="legacy-rescue-title" className="edit-mode-modal-title">
            未保存の旧データが見つかりました
          </h5>
          <button
            type="button"
            className="btn-close"
            onClick={onDiscard}
            aria-label="閉じる"
          />
        </div>
        <div className="edit-mode-modal-body">
          <p>
            以前の編集セッションで保存されなかったデータ (localStorage) が残っています。
            draft に変換して編集を継続しますか？
          </p>
          <div className="edit-mode-modal-footer">
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              onClick={onDiscard}
              data-testid="legacy-rescue-discard"
            >
              破棄する
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onAdopt}
              data-testid="legacy-rescue-adopt"
            >
              draft に変換して続ける
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
