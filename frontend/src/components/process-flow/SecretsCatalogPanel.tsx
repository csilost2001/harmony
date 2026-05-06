/**
 * ProcessFlow.context.catalogs.secrets 編集パネル (#278 / #414 values 編集対応 / #570 v3 移行)。
 *
 * - source / name / rotationDays / lastRotatedAt / description は従来通り。
 * - values: 環境別の参照式 (vault:// / env:// / k8s-secret://) を編集可能 (#414)。
 *   旧フォーマット (values 無し) も valid のまま (後方互換)。
 */
import { useState } from "react";
import type { ProcessFlow, SecretRef } from "../../types/action";

interface Props {
  group: ProcessFlow;
  onChange: (group: ProcessFlow) => void;
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
  render?: "full" | "toggleOnly" | "bodyOnly";
}

const DEFAULT_ENV_KEYS = ["dev", "staging", "prod"] as const;

function ValuesEditor({
  values,
  onChange,
  fieldPathPrefix,
}: {
  values: Record<string, string> | undefined;
  onChange: (next: Record<string, string> | undefined) => void;
  fieldPathPrefix: string;
}) {
  const [newEnvKey, setNewEnvKey] = useState("");
  const entries = values ? Object.entries(values) : [];
  const knownKeys = new Set(entries.map(([k]) => k));

  const setEnvValue = (envKey: string, refExpr: string) => {
    const next: Record<string, string> = { ...(values ?? {}) };
    next[envKey] = refExpr;
    onChange(next);
  };

  const removeEnvKey = (envKey: string) => {
    if (!values) return;
    const next: Record<string, string> = { ...values };
    delete next[envKey];
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };

  const addEnvKey = (envKey: string) => {
    const k = envKey.trim();
    if (!k || knownKeys.has(k)) return;
    setEnvValue(k, "");
    setNewEnvKey("");
  };

  return (
    <div className="catalog-values-editor" data-field-path={`${fieldPathPrefix}.values`}>
      <div className="catalog-values-help text-muted small">
        環境別の参照式 (実値ではなく <code>vault://</code> / <code>env://</code> / <code>k8s-secret://</code>)。
        未指定時は source / name にフォールバック。
      </div>
      {entries.length === 0 && (
        <div className="catalog-values-empty text-muted small">
          values 未設定 (旧フォーマット)。下のボタンで dev / staging / prod を一括追加できます。
        </div>
      )}
      {entries.map(([envKey, refExpr]) => (
        <div className="catalog-values-row" key={envKey}>
          <span className="catalog-values-key-badge">{envKey}</span>
          <input
            className="form-control form-control-sm catalog-values-ref"
            value={refExpr}
            data-field-path={`${fieldPathPrefix}.values.${envKey}`}
            placeholder="vault://stripe/dev/secret_key"
            onChange={(ev) => setEnvValue(envKey, ev.target.value)}
          />
          <button
            type="button"
            className="btn btn-sm btn-link text-danger"
            onClick={() => removeEnvKey(envKey)}
            title={`${envKey} を削除`}
          >
            <i className="bi bi-x-lg" />
          </button>
        </div>
      ))}
      <div className="catalog-values-row catalog-values-row-add">
        <input
          className="form-control form-control-sm catalog-values-newkey"
          placeholder="新規 env キー (例: prod-jp)"
          value={newEnvKey}
          onChange={(ev) => setNewEnvKey(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") {
              ev.preventDefault();
              addEnvKey(newEnvKey);
            }
          }}
        />
        <button
          type="button"
          className="btn btn-sm btn-outline-primary"
          onClick={() => addEnvKey(newEnvKey)}
          disabled={!newEnvKey.trim() || knownKeys.has(newEnvKey.trim())}
        >
          <i className="bi bi-plus-lg" /> env 追加
        </button>
        {entries.length === 0 && (
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary ms-1"
            onClick={() => {
              const seed: Record<string, string> = {};
              for (const k of DEFAULT_ENV_KEYS) seed[k] = "";
              onChange(seed);
            }}
            title="dev / staging / prod を一括追加"
          >
            <i className="bi bi-magic" /> 一括 (dev/staging/prod)
          </button>
        )}
      </div>
    </div>
  );
}

export function SecretsCatalogPanel({ group, onChange, expanded: expandedProp, onExpandedChange, render = "full" }: Props) {
  const [expandedState, setExpandedState] = useState(false);
  const isControlled = expandedProp !== undefined;
  const expanded = isControlled ? expandedProp : expandedState;
  const setExpanded = (next: boolean) => {
    if (!isControlled) setExpandedState(next);
    onExpandedChange?.(next);
  };
  const [newKey, setNewKey] = useState("");
  const catalog = group.context?.catalogs?.secrets ?? {};
  const keys = Object.keys(catalog);

  const setCatalog = (next: Record<string, SecretRef> | undefined) => {
    onChange({ ...group, context: { ...(group.context ?? {}), catalogs: { ...(group.context?.catalogs ?? {}), secrets: next } } });
  };

  const updateEntry = (key: string, patch: Partial<SecretRef>) => {
    setCatalog({ ...catalog, [key]: { ...catalog[key], ...patch } });
  };

  const removeEntry = (key: string) => {
    const next = { ...catalog };
    delete next[key];
    setCatalog(Object.keys(next).length > 0 ? next : undefined);
  };

  const addEntry = () => {
    const key = newKey.trim();
    if (!key || catalog[key]) return;
    setCatalog({ ...catalog, [key]: { source: "env", name: "" } });
    setNewKey("");
  };

  const showToggle = render !== "bodyOnly";
  const showBody = render === "bodyOnly" || (render !== "toggleOnly" && expanded);
  return (
    <div className="catalog-panel secrets-catalog-panel">
      {showToggle && (
        <button
          type="button"
          className="catalog-panel-toggle"
          onClick={() => setExpanded(!expanded)}
        >
          <i className={`bi bi-chevron-${expanded ? "down" : "right"}`} />
          <i className="bi bi-key" />
          {" "}Secrets (secrets: {keys.length} 件)
        </button>
      )}
      {showBody && (
        <div className="catalog-panel-body">
          <div className="catalog-help">
            秘匿値のメタデータのみ管理。値そのものは含まない。
            ExternalAuth.tokenRef から <code>@secret.&lt;key&gt;</code> で参照。
            values 欄で環境別 (dev/staging/prod) の参照式を宣言可能 (#414)。
          </div>
          {keys.length === 0 && <div className="catalog-empty">まだエントリがありません。</div>}
          {keys.map((k) => {
            const e = catalog[k];
            return (
              <div className="catalog-row" key={k} data-field-path={`context.catalogs.secrets.${k}`}>
                <div className="catalog-row-header">
                  <span className="catalog-key-badge">{k}</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-link text-danger ms-auto"
                    onClick={() => removeEntry(k)}
                    title="削除"
                  >
                    <i className="bi bi-trash" />
                  </button>
                </div>
                <div className="catalog-row-fields">
                  <label>
                    source
                    <select
                      className="form-select form-select-sm"
                      value={e.source}
                      data-field-path={`context.catalogs.secrets.${k}.source`}
                      onChange={(ev) => updateEntry(k, { source: ev.target.value as SecretRef["source"] })}
                    >
                      <option value="env">env (環境変数)</option>
                      <option value="vault">vault (secret store)</option>
                      <option value="file">file (ファイル、開発用)</option>
                    </select>
                  </label>
                  <label>
                    name / path
                    <input
                      className="form-control form-control-sm"
                      value={e.name}
                      data-field-path={`context.catalogs.secrets.${k}.name`}
                      onChange={(ev) => updateEntry(k, { name: ev.target.value })}
                      placeholder={e.source === "env" ? "STRIPE_SECRET_KEY" : e.source === "vault" ? "secret/stripe/api-key" : "/etc/secrets/dev.pem"}
                    />
                  </label>
                  <label>
                    rotationDays
                    <input
                      type="number"
                      className="form-control form-control-sm"
                      value={e.rotationDays ?? ""}
                      data-field-path={`context.catalogs.secrets.${k}.rotationDays`}
                      min={1}
                      onChange={(ev) => updateEntry(k, { rotationDays: ev.target.value === "" ? undefined : Number(ev.target.value) })}
                    />
                  </label>
                  <label>
                    lastRotatedAt
                    <input
                      type="datetime-local"
                      className="form-control form-control-sm"
                      value={e.lastRotatedAt ? e.lastRotatedAt.slice(0, 16) : ""}
                      data-field-path={`context.catalogs.secrets.${k}.lastRotatedAt`}
                      onChange={(ev) => updateEntry(k, { lastRotatedAt: ev.target.value ? new Date(ev.target.value).toISOString() : undefined })}
                    />
                  </label>
                  <label className="catalog-wide">
                    description
                    <input
                      className="form-control form-control-sm"
                      value={e.description ?? ""}
                      data-field-path={`context.catalogs.secrets.${k}.description`}
                      onChange={(ev) => updateEntry(k, { description: ev.target.value || undefined })}
                    />
                  </label>
                  <div className="catalog-wide">
                    <div className="form-label small fw-semibold mb-1">
                      values (環境別参照式)
                    </div>
                    <ValuesEditor
                      values={e.values}
                      onChange={(nextValues) => updateEntry(k, { values: nextValues })}
                      fieldPathPrefix={`context.catalogs.secrets.${k}`}
                    />
                  </div>
                </div>
              </div>
            );
          })}
          <div className="catalog-row catalog-row-add">
            <input
              className="form-control form-control-sm catalog-new-key"
              placeholder="新規 secret id (例: stripeApiKey)"
              value={newKey}
              onChange={(ev) => setNewKey(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); addEntry(); } }}
            />
            <button
              type="button"
              className="btn btn-sm btn-outline-primary"
              onClick={addEntry}
              disabled={!newKey.trim() || Object.hasOwn(catalog, newKey.trim())}
            >
              <i className="bi bi-plus-lg" /> 追加
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
