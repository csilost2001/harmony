/**
 * AI が人間セッションに代わって操作する際の owner/actor 解決ロジック (#690)。
 *
 * - onBehalfOfSession が省略された場合: caller が owner かつ actor (通常操作)
 * - onBehalfOfSession が指定された場合: 指定セッションが owner、caller が actor (AI 委任操作)
 *   - 指定セッションがアクティブでない場合は INVALID_ON_BEHALF_OF_SESSION エラー
 */

export interface OnBehalfOfResult {
  owner: string;
  actor: string;
  isDelegated: boolean;
}

/**
 * onBehalfOfSession パラメータを解決し、owner/actor を返す。
 *
 * @param callerSessionId - 呼び出し元のセッション ID (MCP tool caller)
 * @param onBehalfOfSession - 人間セッションの ID (省略可)
 * @param isActiveSession - セッションがアクティブか判定する関数
 * @throws Error INVALID_ON_BEHALF_OF_SESSION: セッションが存在しないまたは切断済み
 */
export function resolveOnBehalfOfSession(
  callerSessionId: string,
  onBehalfOfSession: string | undefined,
  isActiveSession: (id: string) => boolean,
): OnBehalfOfResult {
  if (!onBehalfOfSession) {
    return { owner: callerSessionId, actor: callerSessionId, isDelegated: false };
  }
  if (!isActiveSession(onBehalfOfSession)) {
    throw new Error(`INVALID_ON_BEHALF_OF_SESSION: ${onBehalfOfSession}`);
  }
  return { owner: onBehalfOfSession, actor: callerSessionId, isDelegated: true };
}

/**
 * 委任操作の監査ログを出力する。isDelegated が false の場合は何もしない。
 */
export function logAuditIfDelegated(
  toolName: string,
  result: OnBehalfOfResult,
  resourceType: string,
  resourceId: string,
): void {
  if (result.isDelegated) {
    console.error(
      `[audit] tool=${toolName} owner=${result.owner} actor=${result.actor} resource=${resourceType}:${resourceId}`,
    );
  }
}
