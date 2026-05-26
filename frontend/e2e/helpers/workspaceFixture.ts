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
 *   - workspace-folder-picker.spec.ts (`fixturePath` で fixture root を分離)
 *   - lockdown-routing.spec.ts (`lockdownWorkspacePath` で lockdown fixture を分離)
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
 * **注意**: `playwright.lockdown.config.ts` は `webServer.env.DESIGNER_DATA_DIR` を
 * Playwright controller process の起動時 (= worker spawn 前) に評価するため、worker
 * 単位で path を変える設計には現状の architecture では対応不可。lockdown config は
 * `workers: 1` 固定で運用しており、worker index は常に `0` で解決される。
 *
 * 本 helper はあくまで `lockdown-routing.spec.ts` (spec 側) と config 側の path 構築
 * ロジックを単一 source of truth に揃える目的で導入した。両者が同じ helper を呼ぶ
 * ことで、将来 lockdown config を多 worker 化する際の整合性ハザードを回避できる。
 */
export function lockdownWorkspacePath(): string {
  return workerScopedPath("e2e-workspaces", "lockdown-routing");
}
