/**
 * 共通のツールチップの文 (UI 改善提案 続編 第 10 弾 #196)。ボタンの title は「説明 (Ctrl+S)」の形で書かれているので、
 * 末尾の括弧がキーの組み合わせなら、説明とキーに分けて、キーを kbd で見せられるようにする。画面に依存しない純関数。
 */
export interface TooltipParts { text: string; keys: string[] }

const KEY_TOKEN = /^(Ctrl|Alt|Shift|Cmd|Meta|Esc|Enter|Tab|Space|Backspace|Delete|Home|End|PageUp|PageDown|F\d{1,2}|[A-Za-z0-9[\]/?+\-=,.`←→↑↓])$/;

/** 括弧の中身が、キーの組み合わせか (+ で区切った各部が、キー名・1 文字のキー) */
function asKeys(inner: string): string[] | null {
  const parts = inner.split("+").map((s) => s.trim());
  // 「+」自体のキー (Ctrl++) は、空の部が出るので、扱わない
  if (parts.length === 0 || parts.some((p) => !p)) return null;
  // 先頭が「?」「+」のように 1 文字のキーだけ、または修飾キー + キーの組
  const ok = parts.every((p) => KEY_TOKEN.test(p));
  if (!ok) return null;
  // 修飾キーを含まない英単語 (例: "ER") を、キーと見間違えない: 1 部だけのときは、特殊キー・1 文字のみ許す
  if (parts.length === 1 && !/^(Esc|Enter|Tab|Space|Backspace|Delete|Home|End|PageUp|PageDown|F\d{1,2}|.)$/.test(parts[0])) return null;
  return parts;
}

export function splitTooltip(title: string): TooltipParts {
  const m = /^(.*?)\s*[（(]([^()（）]{1,40})[）)]\s*$/.exec(title.trim());
  if (m) {
    const keys = asKeys(m[2]);
    if (keys && m[1]) return { text: m[1], keys };
  }
  return { text: title.trim(), keys: [] };
}
