import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import {
  GENERIC_DEFINITION_KINDS,
  GENERIC_DEFINITION_KIND_LABELS,
  GENERIC_DEFINITION_TARGETS,
  GENERIC_DEFINITION_TARGET_LABELS,
  type GenericDefinitionKind,
  type GenericDefinitionTarget,
  type GenericDefinition,
  type GenericField,
  type GenericOperation,
  type GenericRelation,
  type GenericRelationKind,
} from "../../types/v3";
import {
  loadGenericDefinition,
  saveGenericDefinition,
  deleteGenericDefinition,
} from "../../store/genericDefinitionStore";
import { makeTabId, openTab } from "../../store/tabStore";

function isValidKind(k: string): k is GenericDefinitionKind {
  return (GENERIC_DEFINITION_KINDS as string[]).includes(k);
}

const RELATION_KIND_OPTIONS: GenericRelationKind[] = [
  "extends", "implements", "uses", "transformsFrom", "transformsTo", "appliesTo",
];

const RELATION_KIND_LABELS: Record<GenericRelationKind, string> = {
  extends: "継承 (extends)",
  implements: "実装 (implements)",
  uses: "利用 (uses)",
  transformsFrom: "変換元 (transformsFrom)",
  transformsTo: "変換先 (transformsTo)",
  appliesTo: "適用対象 (appliesTo)",
};

export function GenericDefinitionEditor() {
  const { kind: kindParam = "", name: nameParam = "" } = useParams<{ kind: string; name: string }>();
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();

  const kind = isValidKind(kindParam) ? kindParam : null;
  const decodedName = decodeURIComponent(nameParam);

  const [def, setDef] = useState<GenericDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (!kind || !decodedName) return;
    const tabId = makeTabId("generic-definition", `${kind}:${decodedName}`);
    openTab({
      id: tabId,
      type: "generic-definition",
      resourceId: `${kind}:${decodedName}`,
      label: decodedName,
    });
  }, [kind, decodedName]);

  useEffect(() => {
    if (!kind || !decodedName) {
      setError("不正な kind または name です");
      setLoading(false);
      return;
    }
    setLoading(true);
    loadGenericDefinition(kind, decodedName)
      .then((loaded) => {
        if (!loaded) {
          setError(`${decodedName} が見つかりません`);
        } else {
          setDef(loaded);
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, [kind, decodedName]);

  const updateDef = useCallback((updater: (prev: GenericDefinition) => GenericDefinition) => {
    setDef((prev) => prev ? updater(prev) : prev);
  }, []);

  const handleSave = useCallback(async () => {
    if (!def) return;
    setSaveError("");
    if (!def.purpose.trim() || def.purpose.length > 200) {
      setSaveError("目的は 1〜200 文字で入力してください");
      return;
    }
    if (!def.responsibilities.some((r) => r.trim().length > 0)) {
      setSaveError("責務を 1 件以上入力してください");
      return;
    }
    if (def.targets.length === 0) {
      setSaveError("適用領域を 1 つ以上選択してください");
      return;
    }
    setSaving(true);
    try {
      await saveGenericDefinition(def);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [def]);

  const handleDelete = useCallback(async () => {
    if (!kind || !decodedName) return;
    await deleteGenericDefinition(kind, decodedName);
    navigate(wsPath(`/generic-definition/${kind}`));
  }, [kind, decodedName, navigate, wsPath]);

  if (!kind) {
    return <div style={{ padding: "24px", color: "#c00" }}>不正な kind です</div>;
  }

  if (loading) {
    return <div style={{ padding: "24px", color: "#888" }}>読み込み中...</div>;
  }

  if (error) {
    return <div style={{ padding: "24px", color: "#c00" }}>{error}</div>;
  }

  if (!def) return null;

  const fields = def.fields ?? [];
  const operations = def.operations ?? [];
  const relations = def.relations ?? [];
  const constraints = def.constraints ?? [];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "12px 24px", borderBottom: "1px solid #eee", display: "flex", alignItems: "center", gap: "12px" }}>
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
          {GENERIC_DEFINITION_KIND_LABELS[kind]}編集
        </h2>
        <span style={{ fontFamily: "monospace", fontWeight: 600, color: "#0d6efd" }}>{def.name}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
          <button
            className="btn btn-outline-danger btn-sm"
            onClick={() => setShowDeleteConfirm(true)}
          >
            削除
          </button>
          <button
            className="btn btn-outline-secondary btn-sm"
            onClick={() => navigate(wsPath(`/generic-definition/${kind}`))}
          >
            一覧に戻る
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>

      {saveError && (
        <div style={{ padding: "8px 24px", background: "#fff3f3", color: "#c00", fontSize: "0.88rem" }}>
          {saveError}
        </div>
      )}

      {saveSuccess && (
        <div style={{ padding: "8px 24px", background: "#f0fff4", color: "#186429", fontSize: "0.88rem" }}>
          保存しました
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
        <section style={{ marginBottom: "24px" }}>
          <h3 style={{ fontSize: "1rem", marginBottom: "12px" }}>基本情報</h3>
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "10px 16px", alignItems: "start", maxWidth: "700px" }}>
            <label style={labelStyle}>名前</label>
            <input
              type="text"
              value={def.name}
              readOnly
              style={{ ...inputStyle, background: "#f8f9fa", color: "#888", cursor: "not-allowed" }}
            />

            <label style={labelStyle}>種別</label>
            <span style={{ padding: "6px 0", fontSize: "0.88rem" }}>
              <span style={{ background: "#e8f4fd", color: "#0d6efd", padding: "2px 8px", borderRadius: "4px", fontFamily: "monospace" }}>
                {def.kind}
              </span>
              <span style={{ marginLeft: "8px", color: "#555" }}>{GENERIC_DEFINITION_KIND_LABELS[def.kind]}</span>
            </span>

            <label style={labelStyle}>
              目的
              <span style={{ color: "#c00" }}> *</span>
            </label>
            <div>
              <textarea
                value={def.purpose}
                onChange={(e) => updateDef((p) => ({ ...p, purpose: e.target.value }))}
                rows={2}
                style={{ ...inputStyle, resize: "vertical" }}
                placeholder="この定義の目的を 1〜2 行で記述"
              />
              <div style={{ fontSize: "0.75rem", color: def.purpose.length > 200 ? "#c00" : "#888", textAlign: "right" }}>
                {def.purpose.length}/200
              </div>
            </div>
          </div>
        </section>

        <section style={{ marginBottom: "24px" }}>
          <h3 style={{ fontSize: "1rem", marginBottom: "8px" }}>
            責務
            <span style={{ color: "#c00" }}> *</span>
            <span style={{ fontSize: "0.8rem", color: "#888", fontWeight: "normal", marginLeft: "8px" }}>最低 1 件</span>
          </h3>
          {def.responsibilities.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "6px" }}>
              <textarea
                value={r}
                onChange={(e) => {
                  const next = [...def.responsibilities];
                  next[i] = e.target.value;
                  updateDef((p) => ({ ...p, responsibilities: next }));
                }}
                rows={1}
                style={{ ...inputStyle, flex: 1, resize: "vertical" }}
                placeholder={`責務 ${i + 1}`}
              />
              <button
                className="btn btn-outline-secondary btn-sm"
                onClick={() => updateDef((p) => ({ ...p, responsibilities: p.responsibilities.filter((_, j) => j !== i) }))}
                style={{ alignSelf: "flex-start" }}
              >
                削除
              </button>
            </div>
          ))}
          <button
            className="btn btn-outline-primary btn-sm"
            onClick={() => updateDef((p) => ({ ...p, responsibilities: [...p.responsibilities, ""] }))}
          >
            + 追加
          </button>
        </section>

        <section style={{ marginBottom: "24px" }}>
          <h3 style={{ fontSize: "1rem", marginBottom: "8px" }}>
            適用領域
            <span style={{ color: "#c00" }}> *</span>
          </h3>
          <div style={{ display: "flex", gap: "16px" }}>
            {GENERIC_DEFINITION_TARGETS.map((t) => (
              <label key={t} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.88rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={def.targets.includes(t)}
                  onChange={(e) => {
                    const next: GenericDefinitionTarget[] = e.target.checked
                      ? [...def.targets, t]
                      : def.targets.filter((x) => x !== t);
                    updateDef((p) => ({ ...p, targets: next }));
                  }}
                />
                {GENERIC_DEFINITION_TARGET_LABELS[t]}
              </label>
            ))}
          </div>
        </section>

        <section style={{ marginBottom: "24px" }}>
          <h3 style={{ fontSize: "1rem", marginBottom: "8px" }}>フィールド</h3>
          {fields.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", marginBottom: "8px" }}>
              <thead>
                <tr style={{ background: "#f8f9fa" }}>
                  <th style={thStyle}>名前</th>
                  <th style={thStyle}>型</th>
                  <th style={thStyle}>制約</th>
                  <th style={thStyle}>説明</th>
                  <th style={{ ...thStyle, width: "50px" }}></th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>
                      <input
                        value={f.name}
                        onChange={(e) => {
                          const next = fields.map((x, j) => j === i ? { ...x, name: e.target.value } : x);
                          updateDef((p) => ({ ...p, fields: next }));
                        }}
                        style={inputStyle}
                        placeholder="fieldName"
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        value={f.type}
                        onChange={(e) => {
                          const next = fields.map((x, j) => j === i ? { ...x, type: e.target.value } : x);
                          updateDef((p) => ({ ...p, fields: next }));
                        }}
                        style={inputStyle}
                        placeholder="string"
                      />
                    </td>
                    <td style={tdStyle}>
                      <textarea
                        value={(f.constraints ?? []).join("\n")}
                        onChange={(e) => {
                          const cs = e.target.value.split("\n");
                          const next = fields.map((x, j) => j === i ? { ...x, constraints: cs } : x);
                          updateDef((p) => ({ ...p, fields: next }));
                        }}
                        rows={2}
                        style={{ ...inputStyle, resize: "vertical" }}
                        placeholder={"必須\n最大 64 文字"}
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        value={f.description ?? ""}
                        onChange={(e) => {
                          const next = fields.map((x, j) => j === i ? { ...x, description: e.target.value } : x);
                          updateDef((p) => ({ ...p, fields: next }));
                        }}
                        style={inputStyle}
                        placeholder="説明"
                      />
                    </td>
                    <td style={tdStyle}>
                      <button
                        className="btn btn-outline-secondary btn-sm"
                        onClick={() => updateDef((p) => ({ ...p, fields: (p.fields ?? []).filter((_, j) => j !== i) }))}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button
            className="btn btn-outline-primary btn-sm"
            onClick={() => {
              const newField: GenericField = { name: "", type: "" };
              updateDef((p) => ({ ...p, fields: [...(p.fields ?? []), newField] }));
            }}
          >
            + 行追加
          </button>
        </section>

        <section style={{ marginBottom: "24px" }}>
          <h3 style={{ fontSize: "1rem", marginBottom: "8px" }}>オペレーション</h3>
          {operations.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", marginBottom: "8px" }}>
              <thead>
                <tr style={{ background: "#f8f9fa" }}>
                  <th style={thStyle}>名前</th>
                  <th style={thStyle}>説明</th>
                  <th style={{ ...thStyle, width: "50px" }}></th>
                </tr>
              </thead>
              <tbody>
                {operations.map((op, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>
                      <input
                        value={op.name}
                        onChange={(e) => {
                          const next = operations.map((x, j) => j === i ? { ...x, name: e.target.value } : x);
                          updateDef((p) => ({ ...p, operations: next }));
                        }}
                        style={inputStyle}
                        placeholder="operationName"
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        value={op.description ?? ""}
                        onChange={(e) => {
                          const next = operations.map((x, j) => j === i ? { ...x, description: e.target.value } : x);
                          updateDef((p) => ({ ...p, operations: next }));
                        }}
                        style={inputStyle}
                        placeholder="説明"
                      />
                    </td>
                    <td style={tdStyle}>
                      <button
                        className="btn btn-outline-secondary btn-sm"
                        onClick={() => updateDef((p) => ({ ...p, operations: (p.operations ?? []).filter((_, j) => j !== i) }))}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button
            className="btn btn-outline-primary btn-sm"
            onClick={() => {
              const newOp: GenericOperation = { name: "" };
              updateDef((p) => ({ ...p, operations: [...(p.operations ?? []), newOp] }));
            }}
          >
            + 行追加
          </button>
        </section>

        <section style={{ marginBottom: "24px" }}>
          <h3 style={{ fontSize: "1rem", marginBottom: "8px" }}>リレーション</h3>
          {relations.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", marginBottom: "8px" }}>
              <thead>
                <tr style={{ background: "#f8f9fa" }}>
                  <th style={thStyle}>種別</th>
                  <th style={thStyle}>参照先</th>
                  <th style={thStyle}>説明</th>
                  <th style={{ ...thStyle, width: "50px" }}></th>
                </tr>
              </thead>
              <tbody>
                {relations.map((rel, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>
                      <select
                        value={rel.kind}
                        onChange={(e) => {
                          const next = relations.map((x, j) => j === i ? { ...x, kind: e.target.value as GenericRelationKind } : x);
                          updateDef((p) => ({ ...p, relations: next }));
                        }}
                        style={inputStyle}
                      >
                        {RELATION_KIND_OPTIONS.map((k) => (
                          <option key={k} value={k}>{RELATION_KIND_LABELS[k]}</option>
                        ))}
                      </select>
                    </td>
                    <td style={tdStyle}>
                      <input
                        value={rel.ref}
                        onChange={(e) => {
                          const next = relations.map((x, j) => j === i ? { ...x, ref: e.target.value } : x);
                          updateDef((p) => ({ ...p, relations: next }));
                        }}
                        style={inputStyle}
                        placeholder="generic-definitions/data-contract/OrderForm"
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        value={rel.description ?? ""}
                        onChange={(e) => {
                          const next = relations.map((x, j) => j === i ? { ...x, description: e.target.value } : x);
                          updateDef((p) => ({ ...p, relations: next }));
                        }}
                        style={inputStyle}
                        placeholder="説明"
                      />
                    </td>
                    <td style={tdStyle}>
                      <button
                        className="btn btn-outline-secondary btn-sm"
                        onClick={() => updateDef((p) => ({ ...p, relations: (p.relations ?? []).filter((_, j) => j !== i) }))}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button
            className="btn btn-outline-primary btn-sm"
            onClick={() => {
              const newRel: GenericRelation = { kind: "uses", ref: "" };
              updateDef((p) => ({ ...p, relations: [...(p.relations ?? []), newRel] }));
            }}
          >
            + 行追加
          </button>
        </section>

        <section style={{ marginBottom: "24px" }}>
          <h3 style={{ fontSize: "1rem", marginBottom: "8px" }}>制約</h3>
          {constraints.map((c, i) => (
            <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "6px" }}>
              <textarea
                value={c}
                onChange={(e) => {
                  const next = constraints.map((x, j) => j === i ? e.target.value : x);
                  updateDef((p) => ({ ...p, constraints: next }));
                }}
                rows={1}
                style={{ ...inputStyle, flex: 1, resize: "vertical" }}
                placeholder={`制約 ${i + 1}`}
              />
              <button
                className="btn btn-outline-secondary btn-sm"
                onClick={() => updateDef((p) => ({ ...p, constraints: (p.constraints ?? []).filter((_, j) => j !== i) }))}
                style={{ alignSelf: "flex-start" }}
              >
                削除
              </button>
            </div>
          ))}
          <button
            className="btn btn-outline-primary btn-sm"
            onClick={() => updateDef((p) => ({ ...p, constraints: [...(p.constraints ?? []), ""] }))}
          >
            + 追加
          </button>
        </section>

        <section style={{ marginBottom: "24px" }}>
          <h3 style={{ fontSize: "1rem", marginBottom: "8px" }}>
            マッピングヒント (mappingHints)
            <span style={{ fontSize: "0.8rem", color: "#888", fontWeight: "normal", marginLeft: "8px" }}>
              JSON 形式。コード生成 AI 向けのヒント情報
            </span>
          </h3>
          <textarea
            value={def.mappingHints ? JSON.stringify(def.mappingHints, null, 2) : ""}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (!raw) {
                updateDef((p) => {
                  const { mappingHints: _, ...rest } = p;
                  return rest as GenericDefinition;
                });
                return;
              }
              try {
                const parsed = JSON.parse(raw) as Record<string, unknown>;
                updateDef((p) => ({ ...p, mappingHints: parsed }));
              } catch {
                // 不正 JSON は state に保留、保存時は無視
              }
            }}
            rows={5}
            style={{ ...inputStyle, width: "100%", maxWidth: "600px", resize: "vertical", fontFamily: "monospace", fontSize: "0.82rem" }}
            placeholder={'{\n  "backend.spring": "...",\n  "frontend.next": "..."\n}'}
          />
        </section>
      </div>

      {showDeleteConfirm && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
        }}>
          <div style={{ background: "#fff", borderRadius: "8px", padding: "24px", minWidth: "320px" }}>
            <h3 style={{ marginTop: 0, fontSize: "1rem" }}>削除確認</h3>
            <p style={{ fontSize: "0.9rem" }}>
              <strong>{def.name}</strong> を削除しますか？この操作は元に戻せません。
            </p>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setShowDeleteConfirm(false)}>
                キャンセル
              </button>
              <button className="btn btn-danger btn-sm" onClick={handleDelete}>
                削除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: "0.88rem",
  paddingTop: "7px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid #ddd",
  borderRadius: "4px",
  padding: "6px 10px",
  fontSize: "0.88rem",
};

const thStyle: React.CSSProperties = {
  padding: "6px 8px",
  textAlign: "left",
  fontSize: "0.82rem",
  color: "#555",
  borderBottom: "1px solid #ddd",
  fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  padding: "4px 8px",
  verticalAlign: "top",
  borderBottom: "1px solid #f0f0f0",
};
