/**
 * 変更履歴パネルの、操作 1 件の呼び名。操作の名前は付いていないので、前後の状態の差 (jsonDiff) から
 * 「カラム › 注文ID › 表示名 を変更」のように作る。
 */
import { describePath, diffJson, formatValue, type Change, type ChangeKind } from "./jsonDiff";

const VERB: Record<ChangeKind, string> = { added: "を追加", removed: "を削除", changed: "を変更", reordered: "を並べ替え" };

/** 差のうち、いちばん目立つもの (追加・削除を先に、変更、並べ替えの順) */
function pickHeadline(changes: readonly Change[]): Change {
  const rank: Record<ChangeKind, number> = { added: 0, removed: 1, changed: 2, reordered: 3 };
  return [...changes].sort((a, b) => rank[a.kind] - rank[b.kind])[0];
}

const EMPTY_LABEL = "(内容の変更なし)";

export function describeEdit(changes: readonly Change[]): string {
  if (changes.length === 0) return EMPTY_LABEL;
  const head = pickHeadline(changes);
  const where = describePath(head.path);
  let text = `${where}${VERB[head.kind]}`;
  if (head.kind === "changed" && !(typeof head.before === "object" && head.before !== null) && !(typeof head.after === "object" && head.after !== null)) {
    text += ` (${formatValue(head.before, 24)} → ${formatValue(head.after, 24)})`;
  }
  return changes.length > 1 ? `${text} ほか ${changes.length - 1} 件` : text;
}

export interface HistoryRow {
  /** 時間順の番号 (0 = 最初の操作) */
  index: number;
  label: string;
  /** この操作の後の状態へ移るのに、いまから何歩か (負 = 戻る、0 = いまの状態、正 = やり直す) */
  delta: number;
  /** やり直せる未来の操作 (まだ戻した状態) */
  future: boolean;
  /** いまの状態は、この操作の後 */
  current: boolean;
  /** 前後で、内容が変わらない操作 (入力の確定だけの履歴など)。一覧には出さない */
  empty: boolean;
}

/**
 * 積まれている履歴を、時間順の操作の一覧にする。
 * 操作 k = 状態 k → 状態 k+1 (状態は 過去… → いま → 未来…)。行を選ぶと、その操作の後の状態へ移る。
 */
export function buildHistoryRows(past: readonly unknown[], present: unknown, future: readonly unknown[]): HistoryRow[] {
  const states = [...past, present, ...future];
  const nowAt = past.length; // states 上の「いま」の位置
  const rows: HistoryRow[] = [];
  for (let k = 0; k < states.length - 1; k++) {
    const after = k + 1;
    rows.push({
      index: k,
      label: describeEdit(diffJson(states[k], states[after])),
      delta: after - nowAt,
      future: after > nowAt,
      current: after === nowAt,
      empty: false,
    });
    rows[rows.length - 1].empty = rows[rows.length - 1].label === EMPTY_LABEL;
  }
  return rows;
}

/**
 * 一覧に出す行 (内容の変わらない操作を除く)。いまの状態に当たる操作が内容の変わらないものだった場合は、
 * 直前の、内容の変わる操作を「いま」にする (内容は同じなので、移る必要はない)。
 */
export function visibleHistoryRows(rows: readonly HistoryRow[]): HistoryRow[] {
  const shown = rows.filter((r) => !r.empty).map((r) => ({ ...r }));
  if (shown.length > 0 && !shown.some((r) => r.delta === 0)) {
    const before = shown.filter((r) => r.delta < 0);
    const last = before[before.length - 1];
    if (last && rows.some((r) => r.delta === 0 && r.empty)) last.current = true;
  }
  return shown.map((r, i) => ({ ...r, index: i }));
}
