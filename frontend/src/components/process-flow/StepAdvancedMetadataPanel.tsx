import { useState } from "react";
import type { Step, TxBoundary, TxBoundaryRole, ExternalChain, ExternalChainPhase } from "../../types/action";
import { SlaPanel } from "./SlaPanel";

interface Props {
  step: Step;
  onChange: (patch: Partial<Step>) => void;
  onCommit?: () => void;
}

const TX_ROLES: TxBoundaryRole[] = ["begin", "member", "end"];
const CHAIN_PHASES: ExternalChainPhase[] = ["authorize", "capture", "cancel", "other"];

/**
 * step に付与される追加メタ情報 (txBoundary / compensatesFor / externalChain) の編集パネル (#208)。
 * 折りたたみ可能。未設定のステップでは「詳細メタ情報を追加」のボタンのみ表示。
 */
export function StepAdvancedMetadataPanel({ step, onChange, onCommit }: Props) {
  const hasAny = !!(step.txBoundary || step.compensatesFor || step.externalChain || step.transactional || step.sla);
  const [expanded, setExpanded] = useState(hasAny);

  const txB = step.txBoundary;
  const setTxBoundary = (patch: Partial<TxBoundary>) => {
    const next: TxBoundary = { role: "begin", txId: "", ...txB, ...patch };
    onChange({ txBoundary: next });
  };
  const clearTxBoundary = () => onChange({ txBoundary: undefined });

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
        詳細メタ情報 (TX / Saga / 外部 chain)
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
          <label className="form-label small mb-0" style={{ width: "6em" }}>TX 境界:</label>
          <select
            className="form-select form-select-sm"
            value={txB?.role ?? ""}
            onChange={(e) => {
              if (!e.target.value) clearTxBoundary();
              else setTxBoundary({ role: e.target.value as TxBoundaryRole });
            }}
            style={{ width: "auto", fontSize: "0.8rem" }}
          >
            <option value="">—</option>
            {TX_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          {txB && (
            <>
              <input
                type="text"
                className="form-control form-control-sm"
                value={txB.txId}
                onChange={(e) => setTxBoundary({ txId: e.target.value })}
                onBlur={() => onCommit?.()}
                placeholder="txId (例: tx-order-main)"
                style={{ fontSize: "0.8rem" }}
              />
              <button type="button" className="btn btn-sm btn-link text-danger p-0" onClick={clearTxBoundary}>
                <i className="bi bi-x" />
              </button>
            </>
          )}
          <label className="form-label small mb-0 ms-2">
            <input
              type="checkbox"
              className="form-check-input me-1"
              checked={!!step.transactional}
              onChange={(e) => onChange({ transactional: e.target.checked || undefined })}
            />
            transactional
          </label>
        </div>
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
