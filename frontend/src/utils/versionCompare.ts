/**
 * 設計の 2 つの版 (保存前の版・いまの内容) の比較と、変更の要約の文 (UI 改善提案 続編 第 9 弾 #163・#164)。画面に依存しない純関数。
 * 差の取り方は、編集中の「変更点」と同じ (jsonDiff: id のある配列は id で対応づける。updatedAt の差は無視)。
 * 人の言葉の要約は、元に戻す・やり直しの通知と同じ (changeSummary)。
 */
import { diffJson, describePath, formatValue, keyLabel, summarizeChanges, type Change, type DiffSegment } from "./jsonDiff";

export interface VersionCompare {
  /** 場所つきの差 (表で並べる用) */
  changes: Change[];
  /** 人の言葉の要約 (重複は除く) */
  summary: string[];
  counts: { added: number; removed: number; changed: number; reordered: number };
}

const MAX_SUMMARY = 60;

/** 場所の道筋の末尾から、「カラム『金額』」のように要素の呼び名を作る (末尾から数えて n 個目の要素) */
function elementName(path: readonly DiffSegment[], upTo: number): string {
  for (let i = upTo - 1; i >= 0; i--) {
    const seg = path[i];
    if (!seg.isElement) continue;
    const coll = i > 0 && !path[i - 1].isElement ? keyLabel(path[i - 1].key) : "";
    const name = seg.label && seg.label !== seg.key ? seg.label : seg.key;
    return `${coll}『${name}』`;
  }
  return "";
}

const short = (v: unknown): string => formatValue(v, 14);

/** 差 1 件を、人の言葉 1 行にする (「カラム『金額』の長さの変更 (10 → 12)」)。id で対応づけた差 (jsonDiff) から作る */
export function describeJsonChange(c: Change): string {
  const path = c.path;
  const last = path[path.length - 1];
  if (c.kind === "reordered") return `${last ? keyLabel(last.key) : "要素"}の並び替え`;
  if (last?.isElement) {
    const owner = elementName(path, path.length - 1);
    const coll = path.length >= 2 && !path[path.length - 2].isElement ? keyLabel(path[path.length - 2].key) : "要素";
    const name = last.label && last.label !== last.key ? last.label : last.key;
    return `${owner ? `${owner}の` : ""}${coll}『${name}』の${c.kind === "added" ? "追加" : "削除"}`;
  }
  const owner = elementName(path, path.length);
  const field = last ? keyLabel(last.key) : "内容";
  if (c.kind === "added") return `${owner ? `${owner}の` : ""}${field}の設定`;
  if (c.kind === "removed") return `${owner ? `${owner}の` : ""}${field}の解除`;
  const complex = (v: unknown) => typeof v === "object" && v !== null;
  return `${owner ? `${owner}の` : ""}${field}の変更${complex(c.before) || complex(c.after) ? "" : ` (${short(c.before)} → ${short(c.after)})`}`;
}

export function compareSnapshots(before: unknown, after: unknown): VersionCompare {
  const changes = diffJson(before, after);
  const summary = [...new Set(changes.map(describeJsonChange))].slice(0, MAX_SUMMARY);
  return { changes, summary, counts: summarizeChanges(changes) };
}

/** 比較の 1 行 (場所・前・後)。表示の文字にする */
export function changeRow(c: Change): { where: string; kind: Change["kind"]; before: string; after: string } {
  return {
    where: describePath(c.path),
    kind: c.kind,
    before: c.kind === "added" ? "" : c.kind === "reordered" ? "(並び替え前)" : formatValue(c.before),
    after: c.kind === "removed" ? "" : c.kind === "reordered" ? "(並び替え後)" : formatValue(c.after),
  };
}

const COUNT_LABELS: Array<[keyof VersionCompare["counts"], string]> = [["added", "追加"], ["changed", "変更"], ["removed", "削除"], ["reordered", "並び替え"]];
export function countsText(counts: VersionCompare["counts"]): string {
  const parts = COUNT_LABELS.filter(([k]) => counts[k] > 0).map(([k, l]) => `${l} ${counts[k]} 件`);
  return parts.length ? parts.join(" / ") : "差はありません";
}

/** コミットメッセージの形 (1 行目 72 文字まで + 箇条書き)。差が無ければ空 */
export function commitMessageText(subject: string, cmp: VersionCompare): string {
  if (cmp.summary.length === 0) return "";
  const first = cmp.summary[0];
  const rest = cmp.summary.length - 1;
  let title = `${subject}を更新: ${first}${rest > 0 ? ` ほか ${rest} か所` : ""}`;
  if (title.length > 72) title = `${title.slice(0, 71)}…`;
  const body = cmp.summary.slice(0, 30).map((s) => `- ${s}`);
  if (cmp.summary.length > 30) body.push(`- ほか ${cmp.summary.length - 30} か所`);
  return `${title}\n\n${body.join("\n")}\n`;
}

/** レビュー依頼 (PR) の本文の形。何を・どれくらい変えたか、確認してほしい点の欄つき */
export function reviewRequestText(subject: string, cmp: VersionCompare, fromLabel: string, toLabel: string): string {
  if (cmp.summary.length === 0) return "";
  const lines = cmp.summary.slice(0, 50).map((s) => `- ${s}`);
  if (cmp.summary.length > 50) lines.push(`- ほか ${cmp.summary.length - 50} か所`);
  return [
    `## 変更の概要`,
    `${subject}の変更です (${fromLabel} → ${toLabel})。${countsText(cmp.counts)}。`,
    "",
    "## 変更点",
    ...lines,
    "",
    "## 確認してほしい点",
    "- ",
    "",
  ].join("\n");
}
