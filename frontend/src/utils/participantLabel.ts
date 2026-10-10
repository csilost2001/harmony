/**
 * 編集セッションの参加者 (人・AI) の表示名。
 * 表示名が付いていない参加者は、ブラウザのセッション ID (UUID) がそのまま入っていて読めないため、
 * 「ゲスト (先頭 4 文字)」にする。AI の表示名 (`Alice@AI`) や、利用者が付けた名前はそのまま使う。
 */
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function guest(id: string): string {
  return `ゲスト (${id.replace(/-/g, "").slice(0, 4)})`;
}

export function participantLabel(displayLabel: string | undefined, sessionId: string): string {
  const label = (displayLabel ?? "").trim();
  // UUID の表示名ならその先頭、空・セッション ID と同じならセッション ID の先頭を使う。それ以外は付けられた名前のまま
  if (UUID_LIKE.test(label)) return guest(label);
  if (!label || label === sessionId) return guest(sessionId);
  return label;
}

/** 保存者などの文字列 (UUID のときだけ「ゲスト」に直す。ID が分からないので先頭 4 文字だけ付ける) */
export function friendlyLabel(label: string | undefined): string {
  const t = (label ?? "").trim();
  return UUID_LIKE.test(t) ? guest(t) : t || "ゲスト";
}
