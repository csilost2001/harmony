import { useState } from "react";

interface Props {
  open: boolean;
  defaultName: string;
  onSave: (name: string, shared: boolean) => void;
  onClose: () => void;
}

export function SaveBlockModal({ open, defaultName, onSave, onClose }: Props) {
  const [name, setName] = useState(defaultName);
  const [shared, setShared] = useState(false);

  if (!open) return null;

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, shared);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="save-block-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="save-block-header">
          <i className="bi bi-bookmark-plus" />
          <span>マイブロックとして保存</span>
          <button className="shortcuts-close" onClick={onClose}>
            <i className="bi bi-x-lg" />
          </button>
        </div>
        <div className="save-block-body">
          <label className="save-block-label">ブロック名</label>
          <input
            className="save-block-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 検索フォーム"
            autoFocus
          />
          <label className="save-block-shared-label">
            <input
              type="checkbox"
              className="save-block-shared-check"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
            />
            <i className="bi bi-share-fill" style={{ color: "#6366f1", fontSize: 12 }} />
            <span>共有ブロックとして登録</span>
            <span className="save-block-shared-hint">（複数画面に一括反映できます）</span>
          </label>
        </div>
        <div className="save-block-footer">
          <button className="code-btn code-btn-secondary" onClick={onClose}>
            キャンセル
          </button>
          <button
            className="code-btn code-btn-primary"
            onClick={handleSave}
            disabled={!name.trim()}
          >
            <i className="bi bi-bookmark-check" /> 保存
          </button>
        </div>
      </div>
    </div>
  );
}
