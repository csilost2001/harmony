import { useState, useEffect } from "react";
import type { TransitionTrigger } from "../../types/flow";
import { TRIGGER_LABELS } from "../../types/flow";

export type HandlePosition = "top" | "bottom" | "left" | "right";

export interface EdgeFormData {
  label: string;
  trigger: TransitionTrigger;
  sourceHandle: HandlePosition;
  targetHandle: HandlePosition;
}

interface Props {
  open: boolean;
  initial?: Partial<EdgeFormData>;
  onSave: (data: EdgeFormData) => void;
  onDelete?: () => void;
  onClose: () => void;
}

const defaultData: EdgeFormData = {
  label: "",
  trigger: "click",
  sourceHandle: "bottom",
  targetHandle: "top",
};

const HANDLE_OPTIONS: { value: HandlePosition; icon: string; label: string }[] = [
  { value: "top",    icon: "bi-arrow-up",    label: "上" },
  { value: "right",  icon: "bi-arrow-right", label: "右" },
  { value: "bottom", icon: "bi-arrow-down",  label: "下" },
  { value: "left",   icon: "bi-arrow-left",  label: "左" },
];

function HandlePicker({
  value,
  onChange,
}: {
  value: HandlePosition;
  onChange: (v: HandlePosition) => void;
}) {
  return (
    <div className="edge-handle-picker">
      {HANDLE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`edge-handle-btn${value === opt.value ? " active" : ""}`}
          onClick={() => onChange(opt.value)}
          title={opt.label}
        >
          <i className={`bi ${opt.icon}`} />
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

export function EdgeEditModal({ open, initial, onSave, onDelete, onClose }: Props) {
  const [form, setForm] = useState<EdgeFormData>({ ...defaultData, ...initial });

  useEffect(() => {
    if (open) {
      setForm({ ...defaultData, ...initial });
    }
  }, [open, initial]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ ...form, label: form.label.trim() });
  };

  return (
    <div className="flow-modal-overlay" onClick={onClose}>
      <div className="flow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flow-modal-header">
          <h3>遷移の編集</h3>
          <button className="flow-modal-close" onClick={onClose}>
            <i className="bi bi-x-lg" />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="flow-modal-body">
            <label htmlFor="edge-label">遷移ラベル</label>
            <input
              id="edge-label"
              type="text"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="例: 詳細ボタン"
              autoFocus
            />

            <label htmlFor="edge-trigger">トリガー</label>
            <select
              id="edge-trigger"
              value={form.trigger}
              onChange={(e) => setForm((f) => ({ ...f, trigger: e.target.value as TransitionTrigger }))}
            >
              {(Object.entries(TRIGGER_LABELS) as [TransitionTrigger, string][]).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>

            <div className="edge-handle-row">
              <div className="edge-handle-group">
                <label>接続元（出発点）</label>
                <HandlePicker
                  value={form.sourceHandle}
                  onChange={(v) => setForm((f) => ({ ...f, sourceHandle: v }))}
                />
              </div>
              <div className="edge-handle-arrow">
                <i className="bi bi-arrow-right" />
              </div>
              <div className="edge-handle-group">
                <label>接続先（到達点）</label>
                <HandlePicker
                  value={form.targetHandle}
                  onChange={(v) => setForm((f) => ({ ...f, targetHandle: v }))}
                />
              </div>
            </div>
          </div>
          <div className="flow-modal-footer" style={{ justifyContent: "space-between" }}>
            {onDelete ? (
              <button
                type="button"
                className="flow-btn flow-btn-secondary"
                style={{ color: "#ef4444", borderColor: "#fecaca" }}
                onClick={onDelete}
              >
                <i className="bi bi-trash" /> 削除
              </button>
            ) : <span />}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="flow-btn flow-btn-secondary" onClick={onClose}>
                キャンセル
              </button>
              <button type="submit" className="flow-btn flow-btn-primary">
                <i className="bi bi-check-lg" /> 保存
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
