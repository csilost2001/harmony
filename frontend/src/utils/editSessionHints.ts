/**
 * 編集セッションの一覧 (editSession.list) から、「前回の編集の続き (未保存の下書き)」を出すかを決める (ISSUE #1528)。
 * 出すのは、自分の Active なセッションに、**保存していない変更が残っているとき**だけ。
 * 保存したまま (編集中のまま) 残っている、同じ人の別のページのセッションは、続きではないので、出さない
 * (出すと、保存済みなのに「未保存の下書き」と出て、初めての人が迷う)。
 */
export interface SessionLike {
  state?: string;
  participants?: Record<string, unknown>;
  /** 変更のたびに増える番号 */
  sequence?: number;
  /** 保存の記録 (最後の保存の時点の sequence を持つ) */
  saveHistory?: Array<{ sequence?: number }>;
}

/** 保存していない変更があるか。番号が分からなければ、あるものとみなす (従来どおり確認を出す) */
export function hasUnsavedChanges(s: SessionLike): boolean {
  if (typeof s.sequence !== "number") return true;
  const last = s.saveHistory && s.saveHistory.length > 0 ? s.saveHistory[s.saveHistory.length - 1].sequence : 0;
  return s.sequence > (typeof last === "number" ? last : 0);
}

/** 自分が参加している Active なセッションのうち、保存していない変更が残っているものがあるか */
export function hasUnsavedOwnSession(sessions: ReadonlyArray<SessionLike>, mySessionId: string): boolean {
  return sessions.some((s) => s.state === "Active" && !!s.participants?.[mySessionId] && hasUnsavedChanges(s));
}
