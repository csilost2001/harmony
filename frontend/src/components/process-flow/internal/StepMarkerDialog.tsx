/**
 * 工程に、AI への指示・質問を付けるダイアログ (工程の右クリックメニューの「AI に指摘」・Ctrl+Alt+M)。
 * 以前は window.prompt (1 行・ブラウザの標準の枠) だった。複数行で書け、種類を選べる。Enter で追加、Shift+Enter で改行。
 */
import { useState } from "react";
import { ModalShell } from "../../common/ModalShell";
import { MARKER_KIND_LABELS } from "../../common/MarkerListPanel";
import { isImeComposing } from "../../../utils/imeKeys";
import type { MarkerKind } from "../../../types/v3";

type AddableKind = Exclude<MarkerKind, "validator">;
const KINDS: AddableKind[] = ["todo", "question", "attention", "chat"];

interface Props {
  /** 対象の工程の名前 (「3. DB アクセス」など) */
  stepLabel: string;
  onSubmit: (body: string, kind: AddableKind) => void;
  onClose: () => void;
}

export function StepMarkerDialog({ stepLabel, onSubmit, onClose }: Props) {
  const [kind, setKind] = useState<AddableKind>("todo");
  const [body, setBody] = useState("");
  const submit = () => { const t = body.trim(); if (t) onSubmit(t, kind); };
  return (
    <div className="step-insert-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <ModalShell className="step-insert-modal" ariaLabel="AI への指示・質問を付ける" onEscape={onClose} data-testid="step-marker-dialog">
        <div className="step-insert-head"><i className="bi bi-megaphone" /> AI への指示・質問<small>{stepLabel}</small></div>
        <div style={{ padding: "0 12px 8px", display: "flex", flexDirection: "column", gap: 8 }}>
          <select className="form-select form-select-sm" value={kind} onChange={(e) => setKind(e.target.value as AddableKind)} aria-label="マーカーの種類" data-testid="step-marker-kind">
            {KINDS.map((k) => <option key={k} value={k}>{MARKER_KIND_LABELS[k]}</option>)}
          </select>
          <textarea
            className="form-control form-control-sm"
            rows={4}
            autoFocus
            value={body}
            placeholder="例: 並行制御の affectedRowsCheck を追加して (Enter で追加、Shift+Enter で改行)"
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !isImeComposing(e)) { e.preventDefault(); submit(); } }}
            data-testid="step-marker-body"
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>キャンセル</button>
            <button type="button" className="btn btn-sm btn-primary" onClick={submit} disabled={!body.trim()} data-testid="step-marker-submit"><i className="bi bi-plus-lg" /> 追加</button>
          </div>
        </div>
        <div className="step-insert-foot"><kbd>Enter</kbd> 追加 <kbd>Shift</kbd>+<kbd>Enter</kbd> 改行 <kbd>Esc</kbd> やめる</div>
      </ModalShell>
    </div>
  );
}
