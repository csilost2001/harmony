import type { AuditStep } from "../../types/action";
import type { ConventionsCatalog } from "../../schemas/conventionsValidator";
import { ConvCompletionInput } from "../common/ConvCompletionInput";

interface Props {
  step: AuditStep;
  onChange: (patch: Partial<AuditStep>) => void;
  onCommit?: () => void;
  conventions?: ConventionsCatalog | null;
}

export function AuditStepPanel({ step, onChange, onCommit, conventions }: Props) {
  const setResource = (patch: Partial<NonNullable<AuditStep["resource"]>>) => {
    const type = (patch.type ?? step.resource?.type ?? "").trim();
    const id = (patch.id ?? step.resource?.id ?? "").trim();
    // 片方だけ入力された中間状態は schema 上 type=""/id="" の片側空 object となり
    // AI 読み取り時に誤判定を招くため、両方揃うまで undefined とする
    if (!type || !id) {
      onChange({ resource: undefined });
    } else {
      onChange({ resource: { type, id } });
    }
  };

  return (
    <>
      <div className="row g-2 mb-2" data-field-path="action">
        <div className="col-12">
          <label className="form-label">
            <i className="bi bi-lightning-charge me-1" />
            業務アクション (action) <span className="text-danger">*</span>
          </label>
          <input
            type="text"
            className="form-control form-control-sm"
            value={step.action}
            onChange={(e) => onChange({ action: e.target.value })}
            onBlur={onCommit}
            placeholder="例: order.create / user.passwordChange / invoice.approve"
            style={{ fontFamily: "monospace" }}
          />
        </div>
      </div>

      <div className="row g-2 mb-2">
        <div className="col-4" data-field-path="resource.type">
          <label className="form-label">
            <i className="bi bi-box me-1" />
            対象リソース種別 (resource.type)
          </label>
          <input
            type="text"
            className="form-control form-control-sm"
            value={step.resource?.type ?? ""}
            onChange={(e) => setResource({ type: e.target.value })}
            onBlur={onCommit}
            placeholder="例: Order / User / Invoice"
            style={{ fontFamily: "monospace" }}
          />
        </div>
        <div className="col-8" data-field-path="resource.id">
          <label className="form-label">
            <i className="bi bi-fingerprint me-1" />
            対象リソース ID (resource.id、式可)
          </label>
          <ConvCompletionInput
            className="form-control form-control-sm"
            value={step.resource?.id ?? ""}
            onValueChange={(v) => setResource({ id: v })}
            onCommit={onCommit}
            conventions={conventions ?? null}
            placeholder="例: @orderId"
            style={{ fontFamily: "monospace" }}
          />
        </div>
      </div>

      <div className="row g-2 mb-2">
        <div className="col-4" data-field-path="result">
          <label className="form-label">
            <i className="bi bi-check2-circle me-1" />
            結果 (result)
          </label>
          <select
            className="form-select form-select-sm"
            value={step.result ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              onChange({ result: v ? (v as AuditStep["result"]) : undefined });
              onCommit?.();
            }}
          >
            <option value="">— (実装で自動判定)</option>
            <option value="success">success (成功)</option>
            <option value="failure">failure (失敗)</option>
          </select>
        </div>
        <div className="col-8" data-field-path="reason">
          <label className="form-label">
            <i className="bi bi-chat-left-quote me-1" />
            理由 (reason、任意・式可)
          </label>
          <ConvCompletionInput
            className="form-control form-control-sm"
            value={step.reason ?? ""}
            onValueChange={(v) => onChange({ reason: v || undefined })}
            onCommit={onCommit}
            conventions={conventions ?? null}
            placeholder="例: @rejectionReason"
            style={{ fontFamily: "monospace" }}
          />
        </div>
      </div>

      <div className="row g-2 mb-2" data-field-path="sensitive">
        <div className="col-12">
          <label className="form-check-label small d-inline-flex align-items-center gap-2">
            <input
              type="checkbox"
              className="form-check-input"
              checked={!!step.sensitive}
              onChange={(e) => {
                // false (default) は出力しない: JSON ノイズを減らすため省略形を採用
                onChange({ sensitive: e.target.checked || undefined });
                onCommit?.();
              }}
            />
            <i className="bi bi-shield-lock" />
            機微データ (sensitive) — オンにすると値本体はマスクし key だけ記録
          </label>
        </div>
      </div>
    </>
  );
}
