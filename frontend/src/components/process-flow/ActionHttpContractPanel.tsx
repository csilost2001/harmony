// @ts-nocheck
import { useState } from "react";
import type { ActionDefinition, HttpMethod, HttpAuthRequirement, HttpResponseSpec } from "../../types/action";

interface Props {
  action: ActionDefinition;
  onChange: (patch: Partial<ActionDefinition>) => void;
}

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const AUTHS: HttpAuthRequirement[] = ["required", "optional", "none"];

/**
 * Action の HTTP 契約 (httpRoute / responses[]) 編集パネル (#206)。
 * 折りたたみ可能。
 */
export function ActionHttpContractPanel({ action, onChange }: Props) {
  const [expanded, setExpanded] = useState(!!action.httpRoute || !!action.responses?.length);

  const route = action.httpRoute;
  const responses = action.responses ?? [];

  const setRoute = (patch: Partial<NonNullable<ActionDefinition["httpRoute"]>>) => {
    const next = { method: "POST" as HttpMethod, path: "", ...route, ...patch };
    onChange({ httpRoute: next });
  };

  const clearRoute = () => onChange({ httpRoute: undefined });

  const addResponse = () => {
    const next: HttpResponseSpec = { status: 200, description: "" };
    onChange({ responses: [...responses, next] });
  };

  const updateResponse = (idx: number, patch: Partial<HttpResponseSpec>) => {
    const next = responses.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onChange({ responses: next });
  };

  const removeResponse = (idx: number) => {
    onChange({ responses: responses.filter((_, i) => i !== idx) });
  };

  return (
    <div className="action-http-contract-panel" style={{ margin: "8px 0", borderTop: "1px dashed #e2e8f0", paddingTop: 8 }}>
      <button
        type="button"
        className="btn btn-sm btn-link p-0 text-dark"
        onClick={() => setExpanded((v) => !v)}
        style={{ fontSize: "0.85rem" }}
      >
        <i className={`bi ${expanded ? "bi-chevron-down" : "bi-chevron-right"} me-1`} />
        <i className="bi bi-globe me-1" />
        HTTP 契約 ({route ? `${route.method} ${route.path}` : "未設定"} / responses: {responses.length})
      </button>
      {expanded && (
        <div style={{ marginLeft: 12, marginTop: 6 }}>
          <div className="row g-2 mb-2 align-items-end">
            <div className="col-auto">
              <label className="form-label small mb-0">Method</label>
              <select
                className="form-select form-select-sm"
                value={route?.method ?? ""}
                onChange={(e) => setRoute({ method: e.target.value as HttpMethod })}
                style={{ width: "auto" }}
              >
                <option value="">—</option>
                {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="col">
              <label className="form-label small mb-0">Path</label>
              <input
                type="text"
                className="form-control form-control-sm"
                value={route?.path ?? ""}
                onChange={(e) => setRoute({ path: e.target.value })}
                placeholder="/api/customers"
              />
            </div>
            <div className="col-auto">
              <label className="form-label small mb-0">Auth</label>
              <select
                className="form-select form-select-sm"
                value={route?.auth ?? "required"}
                onChange={(e) => setRoute({ auth: e.target.value as HttpAuthRequirement })}
                style={{ width: "auto" }}
              >
                {AUTHS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            {route && (
              <div className="col-auto">
                <button
                  type="button"
                  className="btn btn-sm btn-link text-danger"
                  onClick={clearRoute}
                  title="httpRoute 解除"
                >
                  <i className="bi bi-x-circle" />
                </button>
              </div>
            )}
          </div>

          <div className="mb-2 d-flex align-items-center gap-2">
            <label className="form-label small mb-0">responses[]</label>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary py-0"
              onClick={addResponse}
              style={{ fontSize: "0.75rem" }}
            >
              <i className="bi bi-plus-lg" /> 追加
            </button>
          </div>
          {responses.map((r, i) => (
            <div key={i} className="row g-1 mb-1 align-items-center" style={{ fontSize: "0.8rem" }}>
              <div className="col-auto" style={{ width: 60 }}>
                <input
                  type="number"
                  className="form-control form-control-sm"
                  value={r.status}
                  onChange={(e) => updateResponse(i, { status: Number(e.target.value) })}
                  style={{ fontSize: "0.8rem" }}
                />
              </div>
              <div className="col-3">
                <input
                  type="text"
                  className="form-control form-control-sm"
                  value={r.id ?? ""}
                  onChange={(e) => updateResponse(i, { id: e.target.value || undefined })}
                  placeholder="id (例: 409-stock-shortage)"
                  style={{ fontSize: "0.8rem" }}
                />
              </div>
              <div className="col-3">
                <input
                  type="text"
                  className="form-control form-control-sm"
                  value={typeof r.bodySchema === "string" ? r.bodySchema : ""}
                  onChange={(e) => updateResponse(i, { bodySchema: e.target.value || undefined })}
                  placeholder="bodySchema"
                  style={{ fontSize: "0.8rem" }}
                />
              </div>
              <div className="col">
                <input
                  type="text"
                  className="form-control form-control-sm"
                  value={r.description ?? ""}
                  onChange={(e) => updateResponse(i, { description: e.target.value || undefined })}
                  placeholder="description"
                  style={{ fontSize: "0.8rem" }}
                />
              </div>
              <div className="col-auto">
                <button
                  type="button"
                  className="btn btn-sm btn-link text-danger p-0"
                  onClick={() => removeResponse(i)}
                  title="削除"
                >
                  <i className="bi bi-x" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
