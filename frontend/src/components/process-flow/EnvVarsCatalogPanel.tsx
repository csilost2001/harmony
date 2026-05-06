/**
 * ProcessFlow.context.catalogs.envVars 編集パネル (#414 / #570 v3 移行)。
 *
 * Power Platform Environment Variables 由来。
 * - type (string / number / boolean)
 * - description
 * - values: 環境別 (dev / staging / prod 等)
 * - default
 *
 * 同一 ProcessFlow 編集ヘッダ内 (ActionMetaTabBar) の 1 タブとして表示される。
 */
import { useState } from "react";
import type { ProcessFlow, EnvVarEntry } from "../../types/action";

interface Props {
  group: ProcessFlow;
  onChange: (group: ProcessFlow) => void;
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
  render?: "full" | "toggleOnly" | "bodyOnly";
}

const DEFAULT_ENV_KEYS = ["dev", "staging", "prod"] as const;

type Primitive = string | number | boolean;

/** 文字列入力を type に応じて parse。空文字列は undefined 扱い */
function parsePrimitive(raw: string, type: EnvVarEntry["type"]): Primitive | undefined {
  if (raw === "") return undefined;
  if (type === "number") {
    const n = Number(raw);
    if (Number.isNaN(n)) return raw; // 一旦そのまま (式文字列許容)
    return n;
  }
  if (type === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    return raw; // 式文字列扱い (@env.* 等)
  }
  return raw;
}

/** primitive → input 表示文字列 */
function primitiveToInput(v: Primitive | undefined): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function ValuesEditor({
  type,
  values,
  onChange,
  fieldPathPrefix,
}: {
  type: EnvVarEntry["type"];
  values: Record<string, Primitive> | undefined;
  onChange: (next: Record<string, Primitive> | undefined) => void;
  fieldPathPrefix: string;
}) {
  const [newEnvKey, setNewEnvKey] = useState("");
  const entries = values ? Object.entries(values) : [];
  const knownKeys = new Set(entries.map(([k]) => k));

  const setEnvValue = (envKey: string, raw: string) => {
    const parsed = parsePrimitive(raw, type);
    const next: Record<string, Primitive> = { ...(values ?? {}) };
    if (parsed === undefined) {
      delete next[envKey];
    } else {
      next[envKey] = parsed;
    }
    // ただし key 自体は残したい (追加直後の空入力)
    if (parsed === undefined) {
      next[envKey] = type === "boolean" ? false : type === "number" ? 0 : "";
    }
    onChange(next);
  };

  const removeEnvKey = (envKey: string) => {
    if (!values) return;
    const next: Record<string, Primitive> = { ...values };
    delete next[envKey];
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };

  const addEnvKey = (envKey: string) => {
    const k = envKey.trim();
    if (!k || knownKeys.has(k)) return;
    const seed: Primitive = type === "boolean" ? false : type === "number" ? 0 : "";
    onChange({ ...(values ?? {}), [k]: seed });
    setNewEnvKey("");
  };

  return (
    <div className="catalog-values-editor" data-field-path={`${fieldPathPrefix}.values`}>
      <div className="catalog-values-help text-muted small">
        環境別の値 (dev / staging / prod 等)。<code>@env.&lt;KEY&gt;</code> 解決時に当該環境の値が使われる。未指定時は <code>default</code> にフォールバック。
      </div>
      {entries.length === 0 && (
        <div className="catalog-values-empty text-muted small">
          values 未設定。下のボタンで dev / staging / prod を一括追加できます。
        </div>
      )}
      {entries.map(([envKey, value]) => (
        <div className="catalog-values-row" key={envKey}>
          <span className="catalog-values-key-badge">{envKey}</span>
          {type === "boolean" ? (
            <select
              className="form-select form-select-sm catalog-values-ref"
              value={primitiveToInput(value)}
              data-field-path={`${fieldPathPrefix}.values.${envKey}`}
              onChange={(ev) => setEnvValue(envKey, ev.target.value)}
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : (
            <input
              className="form-control form-control-sm catalog-values-ref"
              type={type === "number" ? "text" : "text"}
              value={primitiveToInput(value)}
              data-field-path={`${fieldPathPrefix}.values.${envKey}`}
              placeholder={type === "number" ? "0" : type === "string" ? "値 or @env.OTHER 参照" : ""}
              onChange={(ev) => setEnvValue(envKey, ev.target.value)}
            />
          )}
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
              const seed: Record<string, Primitive> = {};
              const init: Primitive = type === "boolean" ? false : type === "number" ? 0 : "";
              for (const k of DEFAULT_ENV_KEYS) seed[k] = init;
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

export function EnvVarsCatalogPanel({
  group,
  onChange,
  expanded: expandedProp,
  onExpandedChange,
  render = "full",
}: Props) {
  const [expandedState, setExpandedState] = useState(false);
  const isControlled = expandedProp !== undefined;
  const expanded = isControlled ? expandedProp : expandedState;
  const setExpanded = (next: boolean) => {
    if (!isControlled) setExpandedState(next);
    onExpandedChange?.(next);
  };
  const [newKey, setNewKey] = useState("");
  const catalog = group.context?.catalogs?.envVars ?? {};
  const keys = Object.keys(catalog);

  const setCatalog = (next: Record<string, EnvVarEntry> | undefined) => {
    onChange({ ...group, context: { ...(group.context ?? {}), catalogs: { ...(group.context?.catalogs ?? {}), envVars: next } } });
  };

  const updateEntry = (key: string, patch: Partial<EnvVarEntry>) => {
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
    setCatalog({ ...catalog, [key]: { type: "string" } });
    setNewKey("");
  };

  const showToggle = render !== "bodyOnly";
  const showBody = render === "bodyOnly" || (render !== "toggleOnly" && expanded);

  return (
    <div className="catalog-panel env-vars-catalog-panel">
      {showToggle && (
        <button
          type="button"
          className="catalog-panel-toggle"
          onClick={() => setExpanded(!expanded)}
        >
          <i className={`bi bi-chevron-${expanded ? "down" : "right"}`} />
          <i className="bi bi-sliders" />
          {" "}環境変数 (envVars: {keys.length} 件)
        </button>
      )}
      {showBody && (
        <div className="catalog-panel-body">
          <div className="catalog-help">
            環境別 (dev/staging/prod) の設定値。<code>@env.&lt;KEY&gt;</code> で式から参照。
            秘匿値は <strong>secrets</strong> カタログ側で扱う。
          </div>
          {keys.length === 0 && <div className="catalog-empty">まだエントリがありません。</div>}
          {keys.map((k) => {
            const e = catalog[k];
            return (
              <div className="catalog-row" key={k} data-field-path={`context.catalogs.envVars.${k}`}>
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
                    type
                    <select
                      className="form-select form-select-sm"
                      value={e.type}
                      data-field-path={`context.catalogs.envVars.${k}.type`}
                      onChange={(ev) => {
                        const nextType = ev.target.value as EnvVarEntry["type"];
                        // type 変更時は default / values を新型に強制しない (ユーザーが直す)。
                        // ただし boolean 切替の見た目崩れを避けるため default のみ未指定化
                        updateEntry(k, { type: nextType });
                      }}
                    >
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                    </select>
                  </label>
                  <label className="catalog-wide">
                    description
                    <input
                      className="form-control form-control-sm"
                      value={e.description ?? ""}
                      data-field-path={`context.catalogs.envVars.${k}.description`}
                      onChange={(ev) => updateEntry(k, { description: ev.target.value || undefined })}
                    />
                  </label>
                  <label className="catalog-wide">
                    default
                    {e.type === "boolean" ? (
                      <select
                        className="form-select form-select-sm"
                        value={e.default === undefined ? "" : (e.default ? "true" : "false")}
                        data-field-path={`context.catalogs.envVars.${k}.default`}
                        onChange={(ev) => {
                          const v = ev.target.value;
                          if (v === "") updateEntry(k, { default: undefined });
                          else updateEntry(k, { default: v === "true" });
                        }}
                      >
                        <option value="">(未指定)</option>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : (
                      <input
                        className="form-control form-control-sm"
                        value={primitiveToInput(e.default as Primitive | undefined)}
                        data-field-path={`context.catalogs.envVars.${k}.default`}
                        placeholder={e.type === "number" ? "0" : "https://api.example.com 等"}
                        onChange={(ev) => {
                          const parsed = parsePrimitive(ev.target.value, e.type);
                          updateEntry(k, { default: parsed });
                        }}
                      />
                    )}
                  </label>
                  <div className="catalog-wide">
                    <div className="form-label small fw-semibold mb-1">
                      values (環境別)
                    </div>
                    <ValuesEditor
                      type={e.type}
                      values={e.values as Record<string, Primitive> | undefined}
                      onChange={(nextValues) => updateEntry(k, { values: nextValues })}
                      fieldPathPrefix={`context.catalogs.envVars.${k}`}
                    />
                  </div>
                </div>
              </div>
            );
          })}
          <div className="catalog-row catalog-row-add">
            <input
              className="form-control form-control-sm catalog-new-key"
              placeholder="新規 env 変数名 (例: STRIPE_API_BASE)"
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
