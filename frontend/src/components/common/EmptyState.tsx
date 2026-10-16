/**
 * 空の状態の共通の部品。一覧・タブの「まだ無い」「該当なし」を、同じ形 (印・見出し・ひとこと・最初の 1 件を作るボタン) で出す。
 * - 何も無いとき: 「<名前>がまだありません」+ 何をするものかのひとこと + 作成のボタン (onCreate があるとき)
 * - 検索・絞り込みで 0 件のとき (filtered): 「該当する<名前>がありません」+ 絞り込みの解除 (onClear があるとき)
 */
import type { ReactNode } from "react";
import { nearNames } from "../../utils/nearNames";
import "../../styles/emptyState.css";

export interface EmptyStateProps {
  /** 対象の名前 (例: 画面・テーブル定義)。見出しに入る */
  noun: string;
  /** Bootstrap Icons のクラス (例: bi-window)。省略時は箱の印 */
  icon?: string;
  /** 何をするものか・何から始めるかのひとこと */
  hint?: ReactNode;
  /** 検索・絞り込みで 0 件になった (何も無いのではない) */
  filtered?: boolean;
  /** 最初の 1 件を作る。渡さなければボタンは出さない (閲覧のみ・作成の入口が別にあるとき) */
  onCreate?: () => void;
  createLabel?: string;
  /** 検索・絞り込みを解除する (filtered のとき) */
  onClear?: () => void;
  /** 小さく出す (タブの中・パネルの中) */
  compact?: boolean;
  testId?: string;
  /** 検索で 0 件のとき、近い名前を出して 1 回で検索語にできる (続編 第 6 弾 #120) */
  suggest?: { names: readonly string[]; query: string; onPick: (name: string) => void };
  children?: ReactNode;
}

export function EmptyState({ noun, icon = "bi-inbox", hint, filtered, onCreate, createLabel, onClear, compact, testId, suggest, children }: EmptyStateProps) {
  const near = filtered && suggest ? nearNames(suggest.query, suggest.names) : [];
  return (
    <div className={`empty-state${compact ? " empty-state--compact" : ""}`} data-testid={testId ?? "empty-state"} data-filtered={filtered ? "true" : undefined}>
      <i className={`bi ${filtered ? "bi-search" : icon} empty-state-icon`} aria-hidden="true" />
      <p className="empty-state-title">{filtered ? `該当する${noun}がありません` : `${noun}がまだありません`}</p>
      {filtered
        ? <p className="empty-state-hint">検索の語や絞り込みを変えてみてください。</p>
        : hint && <p className="empty-state-hint">{hint}</p>}
      {near.length > 0 && (
        <p className="empty-state-near" data-testid="empty-state-near">
          近い名前:{" "}
          {near.map((n) => <button key={n} type="button" className="empty-state-near-btn" onClick={() => suggest!.onPick(n)} data-testid="empty-state-near-item">{n}</button>)}
        </p>
      )}
      {filtered && onClear && (
        <button type="button" className="empty-state-btn" onClick={onClear} data-testid="empty-state-clear"><i className="bi bi-x-circle" /> 絞り込みを解除</button>
      )}
      {!filtered && onCreate && (
        <button type="button" className="empty-state-btn is-primary" onClick={onCreate} data-testid="empty-state-create"><i className="bi bi-plus-lg" /> {createLabel ?? `${noun}を追加`}</button>
      )}
      {children}
    </div>
  );
}
