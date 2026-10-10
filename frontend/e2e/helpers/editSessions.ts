/**
 * E2E 用: ワークスペースに残っている編集セッションをすべて破棄する。
 *
 * ブラウザで「編集開始」したテストの編集セッションは、テストが終わっても backend に残り、
 * 次のテストの「改名の確認」(編集中の参照元があると止める) などに影響する。afterEach で呼ぶ。
 */
import { openBrowserSessionWorkspace, sendBrowserRequest } from "../mcp/_helpers";

export async function discardAllEditSessions(workspacePath: string): Promise<void> {
  try {
    await openBrowserSessionWorkspace(workspacePath);
    const res = await sendBrowserRequest("editSession.list", {}) as { sessions?: Array<{ id: string }> } | null;
    for (const s of res?.sessions ?? []) await sendBrowserRequest("editSession.discard", { editSessionId: s.id }).catch(() => undefined);
  } catch { /* 後始末なので、失敗してもテストの結果には影響させない */ }
}
