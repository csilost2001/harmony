/**
 * 編集セッションの参加者 (人・AI) の表示名。
 * 表示名が付いていない参加者は、ブラウザのセッション ID (UUID) がそのまま入っていて読めないため、
 * 「ゲスト (先頭 4 文字)」にする。AI の表示名 (`Alice@AI`) や、利用者が付けた名前はそのまま使う。
 */
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function participantLabel(displayLabel: string | undefined, sessionId: string): string {
  const label = (displayLabel ?? "").trim();
  const source = UUID_LIKE.test(label) ? label : !label || label === sessionId ? sessionId : null;
  return source === null ? label : `ゲスト (${source.replace(/-/g, "").slice(0, 4)})`;
}

/** 保存者などの文字列 (UUID のときだけ「ゲスト」に直す。ID が分からないので先頭 4 文字だけ付ける) */
export function friendlyLabel(label: string | undefined): string {
  const t = (label ?? "").trim();
  return UUID_LIKE.test(t) ? `ゲスト (${t.replace(/-/g, "").slice(0, 4)})` : t || "ゲスト";
}
