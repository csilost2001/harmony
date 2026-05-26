/**
 * EntityIdInput — top-level entity 創成ダイアログ用の id 入力 component (RFC #1284 / メタ #1292 / ISSUE #1297)
 *
 * 7 entity (Screen / Table / ProcessFlow / Sequence / View / ViewDefinition /
 * PageLayout) の創成ダイアログで再利用する:
 *   - kebab-case 形式 validation (リアルタイム)
 *   - 同 entity type 内 uniqueness check (リアルタイム)
 *   - 衝突時: suffix 候補 + 「適用」ボタン
 *   - 「AI 提案」ボタン: name から Codex で id 生成
 *
 * 親 (modal) は本 component の `isInvalid` prop で submit ボタンの enable/disable を判定する。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { isValidEntityId } from "../../utils/entityIdValidation";
import {
  requestAiSuggestedEntityId,
  suggestUniqueIdSuffix,
} from "../../utils/entityIdSuggestion";
import "../../styles/entityIdInput.css";

export interface EntityIdInputProps {
  /** id field 現在値 */
  value: string;
  /** 変更コールバック (sanitize はしない、生の文字列を渡す) */
  onChange: (id: string) => void;
  /** AI 提案ボタン押下時、生成基となる現在の name (空でも OK、空時は AI 提案 disable) */
  name: string;
  /** 既存 entity id 配列 (uniqueness check 用、同 entity type 内 limited) */
  existingIds: readonly string[];
  /** AI prompt 用ラベル (例: "画面", "テーブル定義", "処理フロー") */
  entityLabel: string;
  /** disabled 状態 (親 form 全体の disable に追従) */
  disabled?: boolean;
  /** HTML id (label 関連付け用) */
  inputId?: string;
  /** placeholder (default: `例: today-sales`) */
  placeholder?: string;
  /** Enter キー押下時のコールバック (modal submit 用) */
  onEnter?: () => void;
  /** validation 状態変化通知 — 親 modal の submit ボタン制御に使う */
  onValidationChange?: (state: EntityIdValidationState) => void;
}

export interface EntityIdValidationState {
  isFormatValid: boolean;
  isUnique: boolean;
  /** 空文字も invalid 扱い (空は submit 不可) */
  isInvalid: boolean;
}

export function EntityIdInput({
  value,
  onChange,
  name,
  existingIds,
  entityLabel,
  disabled = false,
  inputId,
  placeholder = "例: today-sales",
  onEnter,
  onValidationChange,
}: EntityIdInputProps) {
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const existingSet = useMemo(() => new Set(existingIds), [existingIds]);

  // validation 計算 (空も isInvalid=true)
  const trimmed = value.trim();
  const isFormatValid = trimmed.length > 0 && isValidEntityId(trimmed);
  const isUnique = trimmed.length === 0 || !existingSet.has(trimmed);
  const isInvalid = trimmed.length === 0 || !isFormatValid || !isUnique;

  // 親に validation 状態を伝える
  useEffect(() => {
    onValidationChange?.({ isFormatValid, isUnique, isInvalid });
  }, [isFormatValid, isUnique, isInvalid, onValidationChange]);

  const handleAiSuggest = useCallback(async () => {
    if (!name.trim() || aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const suggested = await requestAiSuggestedEntityId({
        name,
        entityLabel,
        existingIds,
      });
      onChange(suggested);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAiError(msg);
    } finally {
      setAiBusy(false);
    }
  }, [name, aiBusy, entityLabel, existingIds, onChange]);

  const handleApplySuggestion = useCallback(() => {
    if (!trimmed) return;
    const suggested = suggestUniqueIdSuffix(trimmed, existingIds);
    if (suggested !== trimmed) onChange(suggested);
  }, [trimmed, existingIds, onChange]);

  const showFormatError = trimmed.length > 0 && !isFormatValid;
  const showUniqueError = trimmed.length > 0 && isFormatValid && !isUnique;
  const suggestedUnique = showUniqueError
    ? suggestUniqueIdSuffix(trimmed, existingIds)
    : null;

  return (
    <div className="entity-id-input">
      <div className="entity-id-input__row">
        <input
          id={inputId}
          type="text"
          className={`form-control form-control-sm entity-id-input__field${isInvalid && trimmed.length > 0 ? " is-invalid" : ""}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onEnter && !isInvalid) {
              e.preventDefault();
              onEnter();
            }
          }}
          placeholder={placeholder}
          disabled={disabled || aiBusy}
          spellCheck={false}
          autoComplete="off"
          data-testid="entity-id-input"
        />
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm entity-id-input__ai-btn"
          onClick={handleAiSuggest}
          disabled={disabled || aiBusy || !name.trim()}
          title={!name.trim() ? "名前を入力してから AI 提案を利用してください" : `${entityLabel}名から id を AI が提案します`}
          data-testid="entity-id-ai-button"
        >
          {aiBusy
            ? <><i className="bi bi-hourglass-split" /> 生成中…</>
            : <><i className="bi bi-robot" /> AI 提案</>}
        </button>
      </div>

      <div className="entity-id-input__hint form-text">
        kebab-case 英単語 (例: <code>today-sales</code>)。ファイル名 / URL / 参照値に使われます。
      </div>

      {showFormatError && (
        <div className="entity-id-input__error invalid-feedback d-block" data-testid="entity-id-format-error">
          <i className="bi bi-exclamation-circle" /> 形式が不正です。小文字英字で始まり、英数字とハイフン (<code>-</code>) のみ使用可能 (例: <code>today-sales</code>、最大 64 字)。
        </div>
      )}

      {showUniqueError && suggestedUnique && (
        <div className="entity-id-input__error invalid-feedback d-block" data-testid="entity-id-unique-error">
          <i className="bi bi-exclamation-circle" /> この id は既に存在します。
          <button
            type="button"
            className="btn btn-link btn-sm entity-id-input__apply-btn p-0 ms-1"
            onClick={handleApplySuggestion}
            disabled={disabled}
            data-testid="entity-id-apply-suggested"
          >
            <code>{suggestedUnique}</code> を適用
          </button>
        </div>
      )}

      {aiError && (
        <div className="entity-id-input__error alert alert-warning py-1 px-2 mb-0 mt-1" data-testid="entity-id-ai-error">
          <i className="bi bi-exclamation-triangle" /> AI 提案に失敗しました: {aiError}
          <br />
          <small>手動で入力してください。</small>
        </div>
      )}
    </div>
  );
}
