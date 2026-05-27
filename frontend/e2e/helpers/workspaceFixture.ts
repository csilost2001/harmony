/**
 * workspaceFixture.ts (#1359)
 *
 * `realWorkspace.ts` を経由しない e2e fixture (workspace-folder-picker / lockdown-routing 等)
 * のために、Playwright worker index を path に embed する thin helper 群を提供する。
 *
 * 設計方針:
 *   - `realWorkspace.ts:currentWorkerIndex()` から worker index を取得 (重複定義しない)
 *   - 出力 path は `.tmp/<category>/w<idx>-<name>/` 形式で統一
 *   - workers=1 環境では `w0-` 固定 prefix で全 path が解決される (regression なし)
 *
 * 利用 spec:
 *   - workspace-folder-picker.spec.ts (`folderPickerFixtureRoot()` で fixture root を分離)
 *   - lockdown-routing.spec.ts (`lockdownWorkspacePath()` で固定 path を共有、worker prefix 非依存)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentWorkerIndex } from "./realWorkspace.ts";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, "../../..");

/**
 * `.tmp/<category>/w<idx>-<name>/` 形式で worker-isolated path を返す。
 * `category` は `.tmp/` 直下のサブディレクトリ (例: `e2e-folder-picker`)。
 *
 * 同 worker 内では同一 path に解決されるため、複数 test ファイルが同 worker に
 * 割り当てられた場合の test 間共有は呼び出し側で setup/teardown 制御すること。
 */
export function workerScopedPath(category: string, name: string): string {
  return path.join(REPO_ROOT, ".tmp", category, `w${currentWorkerIndex()}-${name}`);
}

/**
 * workspace-folder-picker.spec.ts 用の fixture root path を返す。
 *
 * #1056 で導入された `.tmp/e2e-folder-picker/` を worker prefix 化したもの。
 * 各 spec が `${returns}/ws-a` 等の sub path を構築して使う。
 */
export function folderPickerFixtureRoot(): string {
  return workerScopedPath("e2e-folder-picker", "root");
}

/**
 * lockdown-routing.spec.ts 用の固定 workspace path を返す。
 *
 * **重要 (worker index 非依存)**:
 * `playwright.lockdown.config.ts` の `webServer.env.DESIGNER_DATA_DIR` は Playwright
 * controller process (worker spawn 前) で評価され `TEST_WORKER_INDEX` を持たない
 * (常に `"0"` 解決) 一方、CI retry 等で spec worker は `TEST_WORKER_INDEX=1+` で
 * 起動し得る (`realWorkspace.ts:152-157` の docstring 参照)。
 * もし両者を `currentWorkerIndex()` 経由にすると config は `w0-*` を backend に渡し、
 * spec は `w1-*` を seed する path mismatch regression が retry 時のみ発生する。
 *
 * lockdown config は `workers: 1` 固定運用で複数 worker から同 path への並行 write は
 * 発生しないため、worker prefix は不要。**stable な固定 path** を返すことで config /
 * spec / retry 経路で常に一致させる。
 *
 * 本 helper はあくまで spec 側と config 側の path 構築を単一 source of truth に揃え、
 * 将来パス命名を変える際に 1 箇所修正で済むようにする目的で導入。
 */
export function lockdownWorkspacePath(): string {
  return path.join(REPO_ROOT, ".tmp", "e2e-workspaces", "lockdown-routing");
}
