/**
 * コメントの宛先 (@名前) (UI 改善提案 続編 第 9 弾 #165)。画面に依存しない純関数。
 * 利用者名は自己申告 (本人確認ではない) なので、宛先は「その名前の人に読んでほしい」という印で、通知を送る仕組みではない。
 * 名前に空白を含んでよい (山田 太郎)。既知の名前は、長いものから照合する (「山田」と「山田 太郎」が両方あっても、長い方に当たる)。
 */
export interface MentionPart { text: string; mention?: string }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 本文を、宛先とそれ以外に分ける。既知の名前に当たらない `@xxx` (空白まで) も、宛先として扱う */
export function splitMentions(text: string, known: readonly string[]): MentionPart[] {
  const names = [...new Set(known.map((n) => n.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  const knownRe = names.length ? names.map(escapeRe).join("|") : null;
  const re = new RegExp(`@(${knownRe ? `${knownRe}|` : ""}[^\\s@]+)`, "g");
  const parts: MentionPart[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    // メールアドレスの @ (直前が英数字) は宛先にしない
    if (at > 0 && /[A-Za-z0-9._-]/.test(text[at - 1])) continue;
    if (at > last) parts.push({ text: text.slice(last, at) });
    parts.push({ text: m[0], mention: m[1] });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts.length ? parts : [{ text }];
}

/** 本文に含まれる宛先の名前 (重複なし) */
export function mentionsIn(text: string, known: readonly string[]): string[] {
  return [...new Set(splitMentions(text, known).flatMap((p) => (p.mention ? [p.mention] : [])))];
}

/** 自分宛てか (名前が一致。空白・大文字小文字の違いは無視) */
export function isMentioned(text: string, me: string, known: readonly string[]): boolean {
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const target = norm(me);
  if (!target) return false;
  if (mentionsIn(text, [...known, me]).some((n) => norm(n) === target)) return true;
  // 空白を含む名前 (山田 太郎) を、空白なしで書いたもの (@山田太郎) も、自分宛てとして扱う
  return /\s/.test(me.trim()) && norm(text).includes(`@${target}`);
}

/** 入力の宛先に足す候補。すでに本文にある名前は除く */
export function mentionCandidates(text: string, people: readonly string[], limit = 6): string[] {
  const used = new Set(mentionsIn(text, people).map((n) => n.replace(/\s+/g, "")));
  return [...new Set(people.map((p) => p.trim()).filter(Boolean))].filter((p) => !used.has(p.replace(/\s+/g, ""))).slice(0, limit);
}

/** 本文の末尾へ宛先を足す (区切りの空白を整える) */
export function appendMention(text: string, name: string): string {
  const sep = text === "" || /\s$/.test(text) ? "" : " ";
  return `${text}${sep}@${name} `;
}
