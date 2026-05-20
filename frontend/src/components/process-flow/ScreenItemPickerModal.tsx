/**
 * 画面項目ピッカーモーダル (#321)。
 *
 * 処理フローの入出力テーブルから「画面項目から追加」を押したときに開く。
 * 画面 (左) と項目 (右) を選ばせ、選択された ScreenItem から派生した値
 * (name / label / type / required / description) を StructuredFieldsEditor に返す。
 */
import { useEffect, useState } from "react";
import { loadProject } from "../../store/flowStore";
import { loadScreenItems, type ScreenItemsDocument } from "../../store/screenItemsStore";
import type { ScreenItem } from "../../types/v3";
import type { ScreenItemPickResult } from "./StructuredFieldsEditor";
import type { FieldType as V1FieldType } from "../../types/v3";

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (result: ScreenItemPickResult) => void;
}

type ScreenMeta = { id: string; name: string };

/**
 * v3 ScreenItem.type → FieldType への変換。
 * v3 のみの primitive (integer/datetime/json) は string にマップ。
 *
 * TODO(#1233 Batch 4): StructuredFieldsEditor が v3 FieldType (domain/extension) 表示対応したら
 * ここも v3 FieldType そのまま通過に書き換える。それまでは StructuredFieldsEditor が
 * `kind === "custom"` のみ表示対応のため legacy 形式に変換 (v3 schema 違反だが UI 表示優先)。
 */
function v3TypeToV1(type: ScreenItem["type"]): V1FieldType {
  if (typeof type === "string") {
    if (type === "string" || type === "number" || type === "boolean" || type === "date") return type;
    return "string";
  }
  if (type.kind === "extension") return { kind: "custom", label: type.extensionRef } as unknown as V1FieldType;
  if (type.kind === "domain") return { kind: "custom", label: type.domainKey } as unknown as V1FieldType;
  return type;
}

export function ScreenItemPickerModal({ open, onClose, onPick }: Props) {
  const [screens, setScreens] = useState<ScreenMeta[]>([]);
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);
  const [itemsFile, setItemsFile] = useState<ScreenItemsDocument | null>(null);

  useEffect(() => {
    if (!open) return;
    loadProject().then((p) => {
      setScreens(p.screens.map((s) => ({ id: s.id, name: s.name })));
    }).catch(console.error);
  }, [open]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the selected screen immediately clears dependent items.
    if (!selectedScreenId) { setItemsFile(null); return; }
    loadScreenItems(selectedScreenId).then(setItemsFile).catch(console.error);
  }, [selectedScreenId]);

  if (!open) return null;

  const handlePick = (item: ScreenItem) => {
    if (!selectedScreenId) return;
    onPick({
      screenId: selectedScreenId,
      itemId: item.id as string,
      name: item.id as string,
      label: item.label || undefined,
      type: v3TypeToV1(item.type),
      required: item.required || undefined,
      description: item.description || undefined,
    });
    onClose();
  };

  return (
    <div className="screen-item-picker-overlay" onClick={onClose}>
      <div className="screen-item-picker" onClick={(e) => e.stopPropagation()}>
        <div className="screen-item-picker-header">
          <h6 className="mb-0">
            <i className="bi bi-ui-checks-grid me-1" />画面項目から追加
          </h6>
          <button type="button" className="btn btn-sm btn-link" onClick={onClose} aria-label="閉じる">
            <i className="bi bi-x-lg" />
          </button>
        </div>
        <div className="screen-item-picker-body">
          <div className="screen-item-picker-screens">
            <div className="small fw-semibold text-muted mb-1">画面</div>
            {screens.length === 0 && (
              <div className="small text-muted">画面が登録されていません</div>
            )}
            {screens.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`screen-item-picker-screen-row ${selectedScreenId === s.id ? "active" : ""}`}
                onClick={() => setSelectedScreenId(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div className="screen-item-picker-items">
            <div className="small fw-semibold text-muted mb-1">項目</div>
            {!selectedScreenId && <div className="small text-muted">左から画面を選択してください</div>}
            {selectedScreenId && itemsFile && itemsFile.items.length === 0 && (
              <div className="small text-muted">この画面に項目がありません。「画面項目定義」タブで追加してください。</div>
            )}
            {selectedScreenId && itemsFile?.items.map((item, i) => (
              <button
                key={item.id ? `id-${item.id}` : `idx-${i}`}
                type="button"
                className="screen-item-picker-item-row"
                onClick={() => handlePick(item)}
              >
                <div className="screen-item-picker-item-name">{item.id || <span className="text-muted">(ID未設定)</span>}</div>
                <div className="screen-item-picker-item-meta">
                  {item.label && <span className="me-2">{item.label}</span>}
                  <span className="text-muted">
                    {typeof item.type === "string"
                      ? item.type
                      : item.type.kind === "extension"
                        ? item.type.extensionRef
                        : item.type.kind}
                  </span>
                  {item.required && <span className="badge bg-danger ms-2" style={{ fontSize: "0.65rem" }}>必須</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="screen-item-picker-footer">
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
