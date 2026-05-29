/**
 * SaveCompositeDialog.tsx — 選択中ノードを「複合部品」として保存するダイアログ (#1412 P-4)。
 *
 * 設計者が Puck 上で選択した subtree を再利用部品 (composite) として保存する。
 * subtree 切出し (extractSubtree) と依存検出 (collectDependencies) は呼び出し側
 * (PuckBackend の headerActions ボタン) が済ませ、本ダイアログには切出し済 tree を渡す。
 *
 * frontend/AGENTS.md の配置規約に従い、ロジックは editor/puckSubtree.ts、UI は本ファイル
 * (components/puck/) に置く。
 */

import { useState } from "react";
import {
  addCustomPuckComponent,
  type CompositePuckComponentDef,
} from "../../store/puckComponentsStore";
import type { Subtree } from "../../editor/puckSubtree";
import { generateUUID } from "../../utils/uuid";

interface Props {
  /** 切出し済 subtree 断片 (content + zones サブセット)。 */
  tree: Subtree;
  /** subtree が内包する依存部品 (built-in 以外の type) の一覧。 */
  dependencies: string[];
  onClose: () => void;
  onSaved?: (def: CompositePuckComponentDef) => void;
}

export function SaveCompositeDialog({ tree, dependencies, onClose, onSaved }: Props) {
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null);
    if (!label.trim()) {
      setError("複合部品名は必須です。");
      return;
    }
    const def: CompositePuckComponentDef = {
      kind: "composite",
      id: generateUUID(),
      label: label.trim(),
      tree: {
        content: tree.content,
        ...(tree.zones ? { zones: tree.zones } : {}),
      },
      ...(dependencies.length > 0 ? { dependencies } : {}),
    };
    setSaving(true);
    try {
      await addCustomPuckComponent(def);
      onSaved?.(def);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  const nodeCount =
    tree.content.length +
    (tree.zones
      ? Object.values(tree.zones).reduce((sum, arr) => sum + arr.length, 0)
      : 0);

  return (
    <div
      data-testid="save-composite-dialog"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: 24,
          minWidth: 420,
          maxWidth: 560,
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 4px 24px rgba(0,0,0,0.2)",
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 16, fontSize: 18 }}>
          選択を複合部品として保存
        </h2>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontWeight: "bold", marginBottom: 4 }}>
            複合部品名 <span style={{ color: "red" }}>*</span>
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例: 検索フォーム一式"
            style={{ width: "100%", padding: "6px 8px", boxSizing: "border-box" }}
          />
        </div>

        <p style={{ fontSize: 13, color: "#555", marginBottom: 8 }}>
          含まれるノード数: {nodeCount}
        </p>

        {dependencies.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: "bold" }}>依存部品:</span>
            <ul style={{ margin: "4px 0 0", paddingLeft: 20, fontSize: 12, color: "#555" }}>
              {dependencies.map((dep) => (
                <li key={dep}>{dep}</li>
              ))}
            </ul>
            <p style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
              これらの部品が未ロードのワークスペースで配置すると、依存エラーとして表示されます。
            </p>
          </div>
        )}

        {error && (
          <p style={{ color: "red", fontSize: 13, marginBottom: 12 }}>{error}</p>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{ padding: "8px 16px", cursor: "pointer" }}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            style={{
              padding: "8px 16px",
              cursor: saving ? "not-allowed" : "pointer",
              background: "#0070f3",
              color: "#fff",
              border: "none",
              borderRadius: 4,
            }}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
