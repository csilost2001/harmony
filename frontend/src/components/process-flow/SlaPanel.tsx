import type { Sla, OnTimeout } from "../../types/action";

interface Props {
  sla?: Sla;
  onChange: (sla: Sla | undefined) => void;
  label?: string;
}

const ON_TIMEOUT_OPTIONS: Array<{ value: OnTimeout; label: string }> = [
  { value: "throw", label: "throw (エラーにする)" },
  { value: "continue", label: "continue (継続する)" },
  { value: "compensate", label: "compensate (補償処理へ)" },
  { value: "log", label: "log (記録のみ)" },
];

const compact = (next: Sla): Sla | undefined => {
  const normalized: Sla = {};
  if (next.timeoutMs !== undefined) normalized.timeoutMs = next.timeoutMs;
  if (next.onTimeout) normalized.onTimeout = next.onTimeout;
  if (next.warningThresholdMs !== undefined) normalized.warningThresholdMs = next.warningThresholdMs;
  if (next.p95LatencyMs !== undefined) normalized.p95LatencyMs = next.p95LatencyMs;
  if (next.errorCode?.trim()) normalized.errorCode = next.errorCode.trim();
  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const toNumber = (value: string): number | undefined => {
  if (value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

export function SlaPanel({ sla, onChange, label = "SLA / Timeout" }: Props) {
  const patch = (partial: Partial<Sla>) => {
    onChange(compact({ ...(sla ?? {}), ...partial }));
  };

  return (
    <div className="sla-panel" style={{ margin: "8px 0", borderTop: "1px dashed #e2e8f0", paddingTop: 8 }}>
      <div className="d-flex align-items-center gap-2 mb-2">
        <span className="form-label small fw-semibold mb-0">
          <i className="bi bi-stopwatch me-1" />
          {label}
        </span>
        {sla && (
          <button
            type="button"
            className="btn btn-sm btn-link text-danger p-0"
            onClick={() => onChange(undefined)}
            title="SLA を削除"
          >
            <i className="bi bi-x-circle" />
          </button>
        )}
      </div>

      <div className="row g-2 align-items-end">
        <div className="col-sm-3" data-field-path="sla.timeoutMs">
          <label className="form-label small mb-0">タイムアウト ms</label>
          <input
            type="number"
            min={0}
            className="form-control form-control-sm"
            value={sla?.timeoutMs ?? ""}
            onChange={(e) => patch({ timeoutMs: toNumber(e.target.value) })}
            placeholder="2000"
          />
        </div>
        <div className="col-sm-3" data-field-path="sla.onTimeout">
          <label className="form-label small mb-0">タイムアウト時</label>
          <select
            className="form-select form-select-sm"
            value={sla?.onTimeout ?? ""}
            onChange={(e) => patch({ onTimeout: e.target.value ? (e.target.value as OnTimeout) : undefined })}
          >
            <option value="">未指定</option>
            {ON_TIMEOUT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="col-sm-3" data-field-path="sla.warningThresholdMs">
          <label className="form-label small mb-0">警告閾値 ms</label>
          <input
            type="number"
            min={0}
            className="form-control form-control-sm"
            value={sla?.warningThresholdMs ?? ""}
            onChange={(e) => patch({ warningThresholdMs: toNumber(e.target.value) })}
            placeholder="1500"
          />
        </div>
        <div className="col-sm-3" data-field-path="sla.p95LatencyMs">
          <label className="form-label small mb-0">P95 レイテンシ ms</label>
          <input
            type="number"
            min={0}
            className="form-control form-control-sm"
            value={sla?.p95LatencyMs ?? ""}
            onChange={(e) => patch({ p95LatencyMs: toNumber(e.target.value) })}
            placeholder="例: 500"
          />
        </div>
        <div className="col-sm-3" data-field-path="sla.errorCode">
          <label className="form-label small mb-0">エラーコード</label>
          <input
            type="text"
            className="form-control form-control-sm"
            value={sla?.errorCode ?? ""}
            onChange={(e) => patch({ errorCode: e.target.value || undefined })}
            placeholder="TIMEOUT"
            style={{ fontFamily: "monospace" }}
          />
        </div>
      </div>
    </div>
  );
}
