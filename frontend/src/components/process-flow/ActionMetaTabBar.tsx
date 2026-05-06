/**
 * 処理フローエディタの上部タブバー (#309)
 *
 * 以前は名前/種別/説明/成熟度/モードに加え、6 つのカタログパネル (MarkerPanel /
 * ErrorCatalogPanel / AmbientVariablesPanel / SecretsCatalogPanel /
 * ExternalSystemCatalogPanel) が action-editor-info に縦積みされ、
 * 全閉じ状態でもステップ本体までスクロールが必要だった。
 *
 * ここでは各カタログパネルを「タブボタン + body」に分離し、排他的に 1 つだけ
 * body を展開する。成熟度バッジ・進捗・下流モード警告はタブバーに常時表示。
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import type { ProcessFlow, ProcessFlowType, Step } from "../../types/action";
import { PROCESS_FLOW_TYPE_LABELS } from "../../types/action";
import { MaturityBadge } from "./MaturityBadge";
import { MarkerPanel } from "./MarkerPanel";
import { ErrorCatalogPanel } from "./ErrorCatalogPanel";
import { AmbientVariablesPanel } from "./AmbientVariablesPanel";
import { SecretsCatalogPanel } from "./SecretsCatalogPanel";
import { EnvVarsCatalogPanel } from "./EnvVarsCatalogPanel";
import { ExternalSystemCatalogPanel } from "./ExternalSystemCatalogPanel";
import { SlaPanel } from "./SlaPanel";

type TabKey = "info" | "marker" | "error" | "ambient" | "secrets" | "envVars" | "external";

/** グループ内の全ステップを再帰的に走査して maturity 別カウント + 付箋合計を集計 (#196 / #200) */
function countMaturity(group: ProcessFlow): {
  draft: number;
  provisional: number;
  committed: number;
  total: number;
  notes: number;
} {
  const acc = { draft: 0, provisional: 0, committed: 0, total: 0, notes: 0 };
  const visit = (steps: Step[]) => {
    for (const s of steps) {
      const m = s.maturity ?? "draft";
      if (m === "draft") acc.draft++;
      else if (m === "provisional") acc.provisional++;
      else acc.committed++;
      acc.total++;
      acc.notes += s.notes?.length ?? 0;
      if (s.subSteps) visit(s.subSteps);
      if (s.kind === "branch") {
        for (const b of s.branches) visit(b.steps);
        if (s.elseBranch) visit(s.elseBranch.steps);
      }
      if (s.kind === "loop") visit(s.steps);
      if (s.kind === "transactionScope") {
        visit(s.steps);
        if (s.onCommit) visit(s.onCommit);
        if (s.onRollback) visit(s.onRollback);
      }
    }
  };
  for (const act of group.actions) visit(act.steps);
  return acc;
}

interface Props {
  group: ProcessFlow;
  updateGroup: (recipe: (g: ProcessFlow) => void) => void;
  updateGroupSilent: (recipe: (g: ProcessFlow) => void) => void;
}

export function ActionMetaTabBar({ group, updateGroup, updateGroupSilent }: Props) {
  const [active, setActive] = useState<TabKey | null>(null);
  const { wsPath } = useWorkspacePath();
  const setActiveFrom = (k: TabKey, v: boolean) => setActive(v ? k : null);

  const handleInfoChange = (field: string, value: string) => {
    updateGroupSilent((g) => {
      g.meta = { ...(g.meta ?? {}), [field]: value };
    });
  };
  const handleSlaChange = (sla: ProcessFlow["sla"]) => {
    updateGroupSilent((g) => {
      g.meta = { ...(g.meta ?? {}), sla };
    });
  };

  const counts = countMaturity(group);
  const unfinished = counts.draft + counts.provisional;

  // MarkerPanel / 各カタログパネルへの onChange を 1 箇所でまとめる
  const onMarkersChange = (next: ProcessFlow) => {
    updateGroup((g) => { g.authoring = { ...(g.authoring ?? {}), markers: next.authoring?.markers }; });
  };
  const onErrorCatalogChange = (next: ProcessFlow) => {
    updateGroup((g) => { g.context = { ...(g.context ?? {}), catalogs: { ...(g.context?.catalogs ?? {}), errors: next.context?.catalogs?.errors } }; });
  };
  const onAmbientChange = (next: ProcessFlow) => {
    updateGroup((g) => { g.context = { ...(g.context ?? {}), ambientVariables: next.context?.ambientVariables }; });
  };
  const onSecretsChange = (next: ProcessFlow) => {
    updateGroup((g) => { g.context = { ...(g.context ?? {}), catalogs: { ...(g.context?.catalogs ?? {}), secrets: next.context?.catalogs?.secrets } }; });
  };
  const onEnvVarsChange = (next: ProcessFlow) => {
    updateGroup((g) => { g.context = { ...(g.context ?? {}), catalogs: { ...(g.context?.catalogs ?? {}), envVars: next.context?.catalogs?.envVars } }; });
  };
  const onExternalChange = (next: ProcessFlow) => {
    updateGroup((g) => { g.context = { ...(g.context ?? {}), catalogs: { ...(g.context?.catalogs ?? {}), externalSystems: next.context?.catalogs?.externalSystems } }; });
  };

  return (
    <div className="action-meta-tabbar">
      <div className="action-meta-tabs" role="tablist">
        {/* 基本情報タブ (名前/種別/説明/モード) */}
        <div className={`catalog-panel action-meta-info-panel${active === "info" ? " expanded" : ""}`}>
          <button
            type="button"
            className="catalog-panel-toggle"
            onClick={() => setActive((p) => (p === "info" ? null : "info"))}
          >
            <i className={`bi bi-chevron-${active === "info" ? "down" : "right"}`} />
            <i className="bi bi-info-circle" />
            {" "}基本情報
          </button>
        </div>

        <MarkerPanel
          group={group}
          onChange={onMarkersChange}
          render="toggleOnly"
          expanded={active === "marker"}
          onExpandedChange={(v) => setActiveFrom("marker", v)}
        />
        <ErrorCatalogPanel
          group={group}
          onChange={onErrorCatalogChange}
          render="toggleOnly"
          expanded={active === "error"}
          onExpandedChange={(v) => setActiveFrom("error", v)}
        />
        <AmbientVariablesPanel
          group={group}
          onChange={onAmbientChange}
          render="toggleOnly"
          expanded={active === "ambient"}
          onExpandedChange={(v) => setActiveFrom("ambient", v)}
        />
        <SecretsCatalogPanel
          group={group}
          onChange={onSecretsChange}
          render="toggleOnly"
          expanded={active === "secrets"}
          onExpandedChange={(v) => setActiveFrom("secrets", v)}
        />
        <EnvVarsCatalogPanel
          group={group}
          onChange={onEnvVarsChange}
          render="toggleOnly"
          expanded={active === "envVars"}
          onExpandedChange={(v) => setActiveFrom("envVars", v)}
        />
        <ExternalSystemCatalogPanel
          group={group}
          onChange={onExternalChange}
          render="toggleOnly"
          expanded={active === "external"}
          onExpandedChange={(v) => setActiveFrom("external", v)}
        />
        <Link className="btn btn-link btn-sm text-decoration-none" to={wsPath("/extensions?tab=responseTypes")} title="レスポンス型は拡張管理で編集します">
          <i className="bi bi-box-arrow-up-right me-1" />
          レスポンス型
        </Link>

        <div className="action-meta-tabbar-spacer" />

        {/* 常時表示: 成熟度 + 進捗 */}
        <div className="action-meta-tabbar-inline">
          <span className="action-meta-maturity-label">成熟度</span>
          <MaturityBadge
            maturity={group.meta?.maturity}
            size="md"
            onChange={(next) => handleInfoChange("maturity", next)}
          />
          {counts.total > 0 && (
            <span
              className="action-meta-progress"
              title={`確定 ${counts.committed} / 暫定 ${counts.provisional} / 下書き ${counts.draft} (合計 ${counts.total})`}
            >
              <span style={{ color: "#22c55e" }}><i className="bi bi-circle-fill" /> {counts.committed}</span>
              <span style={{ color: "#f97316" }}><i className="bi bi-circle-fill" /> {counts.provisional}</span>
              <span style={{ color: "#f59e0b" }}><i className="bi bi-circle-fill" /> {counts.draft}</span>
              <span className="text-muted">/ {counts.total}</span>
              {counts.notes > 0 && (
                <span className="text-muted" title={`付箋 ${counts.notes} 件`}>
                  <i className="bi bi-sticky" /> {counts.notes}
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* 下流モード未確定警告 (常時表示) */}
      {group.meta?.mode === "downstream" && unfinished > 0 && (
        <div className="alert alert-warning py-1 px-2 mb-0 small d-flex align-items-center gap-2" role="alert">
          <i className="bi bi-exclamation-triangle-fill" />
          <strong>下流モードで未確定ステップあり:</strong>
          <span>🟡 draft {counts.draft} / 🟠 provisional {counts.provisional}</span>
          <span className="text-muted">(AI 実装前に committed に昇格してください)</span>
        </div>
      )}

      {/* アクティブタブの body を全幅で展開。
          data-step-id="__meta-tab-xxx" を付与することで DrawingOverlay が
          描画マーカーを body 要素に anchor 追従させる (タブ切替で body が消えると
          orphan 扱いで非表示、再度開くと元位置に戻る)。 */}
      {active === "info" && (
        <div className="action-meta-body action-meta-info-body" data-step-id="__meta-tab-info">
          <div className="row g-2">
            <div className="col-md-4">
              <label className="form-label small fw-semibold">名前</label>
              <input
                className="form-control form-control-sm"
                value={group.meta?.name ?? ""}
                onChange={(e) => handleInfoChange("name", e.target.value)}
              />
            </div>
            <div className="col-md-2">
              <label className="form-label small fw-semibold">種別</label>
              <select
                className="form-select form-select-sm"
                value={group.meta?.kind ?? "other"}
                onChange={(e) => handleInfoChange("kind", e.target.value)}
              >
                {(["screen", "batch", "scheduled", "system", "common", "other"] as ProcessFlowType[]).map((t) => (
                  <option key={t} value={t}>{PROCESS_FLOW_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div className="col-md-6">
              <label className="form-label small fw-semibold">説明</label>
              <input
                className="form-control form-control-sm"
                value={group.meta?.description ?? ""}
                onChange={(e) => handleInfoChange("description", e.target.value)}
                placeholder="処理フローの概要"
              />
            </div>
          </div>
          <div className="d-flex align-items-center gap-3 mt-2 small">
            <label className="form-label small fw-semibold mb-0">モード</label>
            <div className="btn-group btn-group-sm" role="group" aria-label="モード切替">
              <button
                type="button"
                className={`btn btn-outline-secondary${(group.meta?.mode ?? "upstream") === "upstream" ? " active" : ""}`}
                onClick={() => handleInfoChange("mode", "upstream")}
                title="上流モード: 書きかけ・曖昧を許容"
              >
                <i className="bi bi-pencil me-1" />上流
              </button>
              <button
                type="button"
                className={`btn btn-outline-secondary${group.meta?.mode === "downstream" ? " active" : ""}`}
                onClick={() => handleInfoChange("mode", "downstream")}
                title="下流モード: AI 実装用に確定"
              >
                <i className="bi bi-robot me-1" />下流
              </button>
            </div>
          </div>
          <SlaPanel
            label="フロー SLA / Timeout"
            sla={group.meta?.sla}
            onChange={handleSlaChange}
          />
        </div>
      )}
      {active === "marker" && (
        <div className="action-meta-body" data-step-id="__meta-tab-marker">
          <MarkerPanel group={group} onChange={onMarkersChange} render="bodyOnly" />
        </div>
      )}
      {active === "error" && (
        <div className="action-meta-body" data-step-id="__meta-tab-error">
          <ErrorCatalogPanel group={group} onChange={onErrorCatalogChange} render="bodyOnly" />
        </div>
      )}
      {active === "ambient" && (
        <div className="action-meta-body" data-step-id="__meta-tab-ambient">
          <AmbientVariablesPanel group={group} onChange={onAmbientChange} render="bodyOnly" />
        </div>
      )}
      {active === "secrets" && (
        <div className="action-meta-body" data-step-id="__meta-tab-secrets">
          <SecretsCatalogPanel group={group} onChange={onSecretsChange} render="bodyOnly" />
        </div>
      )}
      {active === "envVars" && (
        <div className="action-meta-body" data-step-id="__meta-tab-envVars">
          <EnvVarsCatalogPanel group={group} onChange={onEnvVarsChange} render="bodyOnly" />
        </div>
      )}
      {active === "external" && (
        <div className="action-meta-body" data-step-id="__meta-tab-external">
          <ExternalSystemCatalogPanel group={group} onChange={onExternalChange} render="bodyOnly" />
        </div>
      )}
    </div>
  );
}
