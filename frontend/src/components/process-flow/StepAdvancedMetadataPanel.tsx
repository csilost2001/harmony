// @ts-nocheck -- v3 strict 型移行 (#1186 Phase 2-E) で loose access パターン露呈、proper narrow は #1016 で deferred
import { useState } from "react";
import type { Step, ExternalChain, ExternalChainPhase } from "../../types/v3";
import { SlaPanel } from "./SlaPanel";

interface Props {
  step: Step;
  onChange: (patch: Partial<Step>) => void;
  onCommit?: () => void;
}

const CHAIN_PHASES: ExternalChainPhase[] = ["authorize", "capture", "cancel", "other"];

/**
 * step に付与される追加メタ情報 (Saga 補償 / 外部 chain / SLA) の編集パネル (#208)。
 * TX 境界は transactionScope step に一本化 (#1221 で txBoundary 廃止)。
 * 折りたたみ可能。未設定のステップでは「詳細メタ情報を追加」のボタンのみ表示。
 */
export function StepAdvancedMetadataPanel({ step, onChange, onCommit }: Props) {
  const hasAny = !!(step.compensatesFor || step.externalChain || step.sla);
  const [expanded, setExpanded] = useState(hasAny);

  const extCh = step.externalChain;
  const setExtChain = (patch: Partial<ExternalChain>) => {
    const next: ExternalChain = { chainId: "", phase: "authorize", ...extCh, ...patch };
    onChange({ externalChain: next });
  };
  const clearExtChain = () => onChange({ externalChain: undefined });

  if (!expanded) {
    return (
      <button
        type="button"
        className="btn btn-sm btn-link text-muted p-0"
        onClick={() => setExpanded(true)}
        style={{ fontSize: "0.75rem" }}
      >
        <i className="bi bi-gear me-1" />
        詳細メタ情報 (Saga / 外部 chain / SLA)
      </button>
    );
  }

  return (
    <div className="step-advanced-metadata" style={{ marginTop: 4, fontSize: "0.8rem" }}>
      <div className="d-flex align-items-center gap-1 mb-1">
        <button
          type="button"
          className="btn btn-sm btn-link p-0 text-dark"
          onClick={() => setExpanded(false)}
          style={{ fontSize: "0.8rem" }}
        >
          <i className="bi bi-chevron-down me-1" />詳細メタ情報
        </button>
      </div>

      <div className="row g-2 mb-1">
        <div className="col-12 d-flex align-items-center gap-1">
          <label className="form-label small mb-0" style={{ width: "6em" }}>Saga 補償:</label>
          <input
            type="text"
            className="form-control form-control-sm"
            value={step.compensatesFor ?? ""}
            onChange={(e) => onChange({ compensatesFor: e.target.value || undefined })}
            onBlur={onCommit}
            placeholder="補償対象ステップ ID (例: step-authorize)"
            style={{ fontSize: "0.8rem" }}
          />
        </div>
      </div>

      <div className="row g-2">
        <div className="col-12 d-flex align-items-center gap-1">
          <label className="form-label small mb-0" style={{ width: "6em" }}>外部 chain:</label>
          <input
            type="text"
            className="form-control form-control-sm"
            value={extCh?.chainId ?? ""}
            onChange={(e) => {
              if (!e.target.value && !extCh?.phase) clearExtChain();
              else setExtChain({ chainId: e.target.value });
            }}
            onBlur={onCommit}
            placeholder="chainId (例: stripe-pi-order)"
            style={{ fontSize: "0.8rem" }}
          />
          <select
            className="form-select form-select-sm"
            value={extCh?.phase ?? ""}
            onChange={(e) => {
              if (!e.target.value) clearExtChain();
              else setExtChain({ phase: e.target.value as ExternalChainPhase });
            }}
            style={{ width: "auto", fontSize: "0.8rem" }}
          >
            <option value="">—</option>
            {CHAIN_PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {extCh && (
            <button type="button" className="btn btn-sm btn-link text-danger p-0" onClick={clearExtChain}>
              <i className="bi bi-x" />
            </button>
          )}
        </div>
      </div>
      <SlaPanel
        label="ステップ SLA / Timeout"
        sla={step.sla}
        onChange={(sla) => {
          onChange({ sla } as Partial<Step>);
          onCommit?.();
        }}
      />
      {step.kind === "externalSystem" && (
        <div className="text-muted small" style={{ marginTop: 4 }}>
          ExternalSystemStep の旧 timeoutMs は後方互換用です。sla.timeoutMs が指定されている場合はそちらを優先します。
        </div>
      )}
    </div>
  );
}
