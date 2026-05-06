// @ts-nocheck
import { useState } from "react";
import type { StepNote, StepNoteType } from "../../types/action";
import { STEP_NOTE_TYPE_VALUES } from "../../types/action";
import { generateUUID } from "../../utils/uuid";

interface Props {
  notes: StepNote[] | undefined;
  onChange: (notes: StepNote[]) => void;
}

const TYPE_META: Record<StepNoteType, { icon: string; label: string; color: string }> = {
  assumption: { icon: "bi-lightbulb", label: "想定", color: "#64748b" },
  prerequisite: { icon: "bi-paperclip", label: "前提", color: "#0ea5e9" },
  todo: { icon: "bi-check2-square", label: "TODO", color: "#a855f7" },
  deferred: { icon: "bi-clock", label: "将来検討", color: "#f97316" },
  question: { icon: "bi-question-circle", label: "質問", color: "#ef4444" },
};

/**
 * 付箋 (notes[]) パネル (#194、docs/spec/process-flow-maturity.md §4)。
 * ステップごとに付箋の表示・追加・削除を行う。
 */
export function NotesPanel({ notes, onChange }: Props) {
  const list = notes ?? [];
  const [expanded, setExpanded] = useState(false);
  const [newType, setNewType] = useState<StepNoteType>("assumption");
  const [newBody, setNewBody] = useState("");

  const addNote = () => {
    const body = newBody.trim();
    if (!body) return;
    const note: StepNote = {
      id: generateUUID(),
      type: newType,
      body,
      createdAt: new Date().toISOString(),
    };
    onChange([...list, note]);
    setNewBody("");
  };

  const removeNote = (id: string) => {
    onChange(list.filter((n) => n.id !== id));
  };

  const updateBody = (id: string, body: string) => {
    onChange(list.map((n) => (n.id === id ? { ...n, body } : n)));
  };

  if (list.length === 0 && !expanded) {
    return (
      <button
        type="button"
        className="btn btn-sm btn-link text-muted p-0 notes-panel-toggle"
        onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
        title="付箋を追加"
        style={{ fontSize: "0.75rem" }}
      >
        <i className="bi bi-sticky me-1" />付箋を追加
      </button>
    );
  }

  return (
    <div className="notes-panel" onClick={(e) => e.stopPropagation()} style={{ padding: "4px 0" }}>
      <button
        type="button"
        className="btn btn-sm btn-link p-0 text-dark notes-panel-header"
        onClick={() => setExpanded((v) => !v)}
        style={{ fontSize: "0.8rem" }}
      >
        <i className={`bi ${expanded ? "bi-chevron-down" : "bi-chevron-right"} me-1`} />
        <i className="bi bi-sticky me-1" />
        付箋 ({list.length})
      </button>
      {expanded && (
        <div className="notes-panel-body" style={{ marginLeft: 8, marginTop: 4 }}>
          {list.map((n) => {
            const meta = TYPE_META[n.type];
            return (
              <div
                key={n.id}
                className="d-flex align-items-start gap-1"
                style={{ marginBottom: 4, fontSize: "0.8rem" }}
              >
                <i
                  className={`bi ${meta.icon}`}
                  title={meta.label}
                  style={{ color: meta.color, flexShrink: 0, marginTop: 3 }}
                />
                <span className="text-muted" style={{ flexShrink: 0, width: "4.5em" }}>
                  {meta.label}:
                </span>
                <textarea
                  className="form-control form-control-sm"
                  value={n.body}
                  onChange={(e) => updateBody(n.id, e.target.value)}
                  rows={1}
                  style={{ fontSize: "0.8rem", resize: "vertical" }}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-link text-danger p-0"
                  onClick={() => removeNote(n.id)}
                  title="付箋を削除"
                  style={{ fontSize: "0.8rem" }}
                >
                  <i className="bi bi-x" />
                </button>
              </div>
            );
          })}
          <div className="d-flex align-items-center gap-1 mt-1" style={{ fontSize: "0.8rem" }}>
            <select
              className="form-select form-select-sm"
              value={newType}
              onChange={(e) => setNewType(e.target.value as StepNoteType)}
              style={{ width: "auto", fontSize: "0.8rem" }}
            >
              {STEP_NOTE_TYPE_VALUES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_META[t].label}
                </option>
              ))}
            </select>
            <input
              type="text"
              className="form-control form-control-sm"
              placeholder="付箋の本文 (Enter で追加)"
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addNote();
                }
              }}
              style={{ fontSize: "0.8rem" }}
            />
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={addNote}
              disabled={!newBody.trim()}
              title="付箋を追加"
            >
              <i className="bi bi-plus-lg" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
