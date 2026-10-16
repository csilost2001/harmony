/**
 * 開いている画面の「要確認」の欄・行・部品を、F8 / Shift+F8 で順に巡る (UI 改善提案 第 5 弾 #88)。
 * 保存が失敗・検証で止まったときに、最初の要確認へ移る (#92) のにも使う。
 * 画面は、要確認の欄・行に、次のどれかを付ける: `aria-invalid="true"` / `.is-invalid` / `.input-error` / `.has-error` / `.has-warning` / `data-issue`。
 * 画面ごとに登録しなくても、印を付けるだけで、F8 の対象になる。
 */

/** 要確認の印のセレクタ */
export const ISSUE_SELECTOR = [
  '[aria-invalid="true"]', ".is-invalid", ".input-error", ".has-error", ".has-warning", "[data-issue]",
  ".vd-col-row--error", ".vd-col-row--warning",
].join(",");

/** 見えている要確認 (画面の上から下への順)。入れ子のものは、外側を除く (中の欄を巡る) */
export function collectIssueElements(root: ParentNode): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(ISSUE_SELECTOR)).filter((el) => el.getClientRects().length > 0 && !el.closest("[data-issue-ignore]"));
  return all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
}

/** いまの位置 (フォーカス / 選択) の次 (dir=1) か前 (-1) の要確認の番号。端では、反対側へ巡る */
export function nextIssueIndex(items: readonly HTMLElement[], from: Node | null, dir: 1 | -1): number {
  if (items.length === 0) return -1;
  if (!from) return dir === 1 ? 0 : items.length - 1;
  const after = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  const before = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING);
  if (dir === 1) {
    const i = items.findIndex((el) => el !== from && !el.contains(from) && after(from, el));
    return i === -1 ? 0 : i;
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const el = items[i];
    if (el !== from && !el.contains(from) && before(from, el)) return i;
  }
  return items.length - 1;
}

const FOCUSABLE = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 要確認へ移る: 欄ならフォーカス、行・部品なら、その中の最初の欄 (無ければ、その要素自身) にフォーカスして見える所へ */
export function focusIssue(el: HTMLElement): void {
  const target = el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE);
  if (target) target.focus({ preventScroll: true });
  else { if (!el.hasAttribute("tabindex")) el.tabIndex = -1; el.focus({ preventScroll: true }); }
  el.scrollIntoView?.({ block: "center", behavior: "smooth" });
  el.classList.add("page-issue-flash");
  setTimeout(() => el.classList.remove("page-issue-flash"), 1200);
}

/** 最初の要確認へ移る。無ければ false */
export function focusFirstIssue(root: ParentNode = document): boolean {
  const first = collectIssueElements(root)[0];
  if (!first) return false;
  focusIssue(first);
  return true;
}
