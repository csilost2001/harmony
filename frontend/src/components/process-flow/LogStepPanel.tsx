import { useState, useEffect, useRef } from "react";
import type { LogStep } from "../../types/action";
import type { ConventionsCatalog } from "../../schemas/conventionsValidator";
import { ConvCompletionInput } from "../common/ConvCompletionInput";
import { generateUUID } from "../../utils/uuid";

interface Props {
  step: LogStep;
  onChange: (patch: Partial<LogStep>) => void;
  onCommit?: () => void;
  conventions?: ConventionsCatalog | null;
}

const LOG_LEVELS: Array<{ value: LogStep["level"]; label: string }> = [
  { value: "trace", label: "trace (詳細追跡)" },
  { value: "debug", label: "debug (デバッグ)" },
  { value: "info", label: "info (情報)" },
  { value: "warn", label: "warn (警告)" },
  { value: "error", label: "error (エラー)" },
];

type RawEntry = { id: string; key: string; value: string };

const toEntries = (sd: Record<string, string> | undefined): RawEntry[] =>
  Object.entries(sd ?? {}).map(([key, value]) => ({ id: generateUUID(), key, value }));

const normalize = (entries: RawEntry[]): Record<string, string> | undefined => {
  // 空 key の行は出力しない (key 編集中の中間状態を保存に出さない)。
  // 重複 key は後勝ち (UI 側で is-invalid 警告を出す)。
  const map: Record<string, string> = {};
  for (const e of entries) {
    const k = e.key.trim();
    if (k) map[k] = e.value;
  }
  return Object.keys(map).length > 0 ? map : undefined;
};

export function LogStepPanel({ step, onChange, onCommit, conventions }: Props) {
  // 内部 state は raw entries (key="" の行も保持) で持つ。
  // step.structuredData (props) には normalize 済の Record<string,string> が入る。
  // → key を一旦全消去しても value が消えない / 重複 key を一時的に許容する。
  const [entries, setEntries] = useState<RawEntry[]>(() => toEntries(step.structuredData));
  // 直前に自分が onChange で送出した normalized 値を記録し、
  // それ以外 (= 外部からの再描画 / undo 等) で props が変わった時のみ entries を再構築する。
  const lastEmittedRef = useRef<Record<string, string> | undefined>(step.structuredData);

  useEffect(() => {
    if (step.structuredData === lastEmittedRef.current) return;
    setEntries(toEntries(step.structuredData));
    lastEmittedRef.current = step.structuredData;
  }, [step.structuredData]);

  const persist = (next: RawEntry[]) => {
    setEntries(next);
    const normalized = normalize(next);
    lastEmittedRef.current = normalized;
    onChange({ structuredData: normalized });
  };

  const updateEntry = (id: string, patch: Partial<Omit<RawEntry, "id">>) => {
    persist(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const removeEntry = (id: string) => {
    persist(entries.filter((e) => e.id !== id));
    onCommit?.();
  };

  const addEntry = () => {
    persist([...entries, { id: generateUUID(), key: "", value: "" }]);
  };

  // 重複 key 検出 (空 key は除外)
  const keyCounts = new Map<string, number>();
  for (const e of entries) {
    const k = e.key.trim();
    if (k) keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
  }
  const isDuplicateKey = (key: string) => {
    const k = key.trim();
    return !!k && (keyCounts.get(k) ?? 0) > 1;
  };

  return (
    <>
      <div className="row g-2 mb-2">
        <div className="col-4" data-field-path="level">
          <label className="form-label">
            <i className="bi bi-bar-chart-steps me-1" />
            ログレベル (level)
          </label>
          <select
            className="form-select form-select-sm"
            value={step.level}
            onChange={(e) => {
              onChange({ level: e.target.value as LogStep["level"] });
              onCommit?.();
            }}
          >
            {LOG_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
        <div className="col-8" data-field-path="category">
          <label className="form-label">
            <i className="bi bi-tag me-1" />
            カテゴリ (category、任意)
          </label>
          <input
            type="text"
            className="form-control form-control-sm"
            value={step.category ?? ""}
            onChange={(e) => onChange({ category: e.target.value || undefined })}
            onBlur={onCommit}
            placeholder="例: order.lifecycle / payment.audit"
          />
        </div>
      </div>

      <div className="row g-2 mb-2" data-field-path="message">
        <div className="col-12">
          <label className="form-label">
            <i className="bi bi-chat-left-text me-1" />
            メッセージ (message)
          </label>
          <ConvCompletionInput
            className="form-control form-control-sm"
            value={step.message}
            onValueChange={(v) => onChange({ message: v })}
            onCommit={onCommit}
            conventions={conventions ?? null}
            placeholder={"例: 注文 @orderId 受付完了 (顧客 @customerId)"}
            style={{ fontFamily: "monospace" }}
          />
        </div>
      </div>

      <div className="row g-2 mb-2" data-field-path="structuredData">
        <div className="col-12">
          <div className="d-flex align-items-center gap-2 mb-1">
            <label className="form-label small mb-0">
              <i className="bi bi-list-columns me-1" />
              構造化データ (structuredData、key=式、任意)
            </label>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary py-0"
              onClick={addEntry}
              style={{ fontSize: "0.75rem" }}
            >
              <i className="bi bi-plus-lg" /> 項目を追加
            </button>
          </div>
          {entries.length === 0 && (
            <div className="text-muted" style={{ fontSize: "0.78rem" }}>
              ログ集計・検索しやすいよう構造化値を残す場合に追加 (例: orderId / amount)
            </div>
          )}
          {entries.map((entry) => {
            const dup = isDuplicateKey(entry.key);
            return (
              <div key={entry.id} className="d-flex align-items-center gap-1 mb-1">
                <input
                  type="text"
                  className={`form-control form-control-sm${dup ? " is-invalid" : ""}`}
                  value={entry.key}
                  onChange={(e) => updateEntry(entry.id, { key: e.target.value })}
                  onBlur={onCommit}
                  placeholder="key"
                  title={dup ? "重複している key (保存時に後勝ちで上書きされます)" : undefined}
                  style={{ width: 160, fontFamily: "monospace", fontSize: "0.8rem" }}
                />
                <span className="text-muted">=</span>
                <ConvCompletionInput
                  className="form-control form-control-sm"
                  value={entry.value}
                  onValueChange={(nv) => updateEntry(entry.id, { value: nv })}
                  onCommit={onCommit}
                  conventions={conventions ?? null}
                  placeholder="例: @orderId / @subtotal + @tax"
                  style={{ fontFamily: "monospace", fontSize: "0.8rem", flex: 1 }}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-link text-danger p-0"
                  onClick={() => removeEntry(entry.id)}
                  title="項目を削除"
                >
                  <i className="bi bi-x" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
