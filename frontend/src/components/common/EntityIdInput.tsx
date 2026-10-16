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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isValidEntityId } from "../../utils/entityIdValidation";
import {
  entityIdCandidates,
  generateFallbackEntityId,
  requestAiSuggestedEntityId,
  suggestUniqueIdSuffix,
} from "../../utils/entityIdSuggestion";
import "../../styles/entityIdInput.css";
import { isImeComposing } from "../../utils/imeKeys";
import { asciiFieldProps } from "../../utils/fieldNormalize";

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
  /**
   * ID の自動入力に使う英数字の名前 (物理名など)。省略時は name を使う。
   * 英数字が含まれていれば、ID が未入力のあいだ (利用者がまだ ID を触っていないあいだ) は、
   * そこから作った ID を自動で入れる。
   */
  idSource?: string;
  /** validation 状態変化通知 — 親 modal の submit ボタン制御に使う */
  onValidationChange?: (state: EntityIdValidationState) => void;
}

/** 仮の ID に付ける接頭辞 (entityLabel から決める。分からないものは item) */
function fallbackPrefixFor(entityLabel: string): string {
  if (entityLabel.includes("画面")) return "screen";
  if (entityLabel.includes("テーブル")) return "table";
  if (entityLabel.includes("処理フロー")) return "flow";
  if (entityLabel.includes("業務フロー")) return "business-flow";
  if (entityLabel.includes("帳票")) return "report";
  if (entityLabel.includes("シーケンス")) return "sequence";
  if (entityLabel.includes("ビュー定義") || entityLabel.includes("ViewDefinition")) return "view-definition";
  if (entityLabel.includes("ビュー")) return "view";
  if (entityLabel.includes("レイアウト")) return "layout";
  if (entityLabel.includes("ガジェット")) return "gadget";
  return "item";
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
  idSource,
  onValidationChange,
}: EntityIdInputProps) {
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const existingSet = useMemo(() => new Set(existingIds), [existingIds]);

  // 利用者が ID を自分で触ったら、以後は自動入力しない。最初から値がある (改名など) ときも自動入力しない
  const touchedRef = useRef(value.trim().length > 0);
  const lastAutoRef = useRef<string | null>(null);
  const changeByUser = useCallback((id: string) => {
    touchedRef.current = true;
    onChange(id);
  }, [onChange]);

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
      touchedRef.current = true;
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
    if (suggested !== trimmed) changeByUser(suggested);
  }, [trimmed, existingIds, changeByUser]);

  // 未入力のとき: 保存できない理由と、すぐ進められる手段を出す
  const emptyAndNamed = trimmed.length === 0 && (name.trim().length > 0 || (idSource ?? "").trim().length > 0);
  const candidateSource = (idSource ?? "").trim() ? (idSource as string) : name;
  const idCandidates = useMemo(() => entityIdCandidates(candidateSource, existingIds), [candidateSource, existingIds]);
  const asciiCandidate = idCandidates[0] ?? null;
  const autoId = touchedRef.current ? null : asciiCandidate;

  useEffect(() => {
    if (touchedRef.current) return;
    if (value.trim().length === 0 && name.trim().length === 0 && (idSource ?? "").trim().length === 0) {
      lastAutoRef.current = null;
      return;
    }
    // 自動入力した値のままか、まだ空のときだけ追従する
    if (value === (lastAutoRef.current ?? "")) {
      const next = autoId ?? "";
      if (next !== value) {
        lastAutoRef.current = next || null;
        onChange(next);
      }
    }
  }, [autoId, value, name, idSource, onChange]);
  const handleUseTemporaryId = useCallback(() => {
    changeByUser(generateFallbackEntityId(fallbackPrefixFor(entityLabel)));
  }, [entityLabel, changeByUser]);

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
          onChange={(e) => changeByUser(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" && !isImeComposing(e)) && onEnter && !isInvalid) {
              e.preventDefault();
              onEnter();
            }
          }}
          placeholder={placeholder}
          disabled={disabled || aiBusy}
          {...asciiFieldProps}
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

      {emptyAndNamed && (
        <div className="entity-id-input__empty-hint form-text" data-testid="entity-id-empty-hint">
          ID を入力すると保存できます。
          {idCandidates.length > 0 ? (
            idCandidates.map((cand, k) => (
              <button
                key={cand}
                type="button"
                className="btn btn-link btn-sm entity-id-input__apply-btn p-0 ms-1"
                onClick={() => changeByUser(cand)}
                disabled={disabled}
                data-testid={k === 0 ? "entity-id-use-candidate" : `entity-id-use-candidate-${k + 1}`}
              >
                <code>{cand}</code> を使う
              </button>
            ))
          ) : (
            <>
              この名前には ID にできない言葉があるため、英語で入力するか、
              <button
                type="button"
                className="btn btn-link btn-sm entity-id-input__apply-btn p-0"
                onClick={handleUseTemporaryId}
                disabled={disabled}
                data-testid="entity-id-use-temporary"
              >
                仮の ID を付ける
              </button>
              (あとから「ID 変更」で直せます)。
            </>
          )}
        </div>
      )}

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
