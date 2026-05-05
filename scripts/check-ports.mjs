/**
 * scripts/check-ports.mjs (#795-B)
 *
 * `npm run dev` 前置チェック: 5173 / 5179 が既に LISTENING の場合、
 * 明示エラーメッセージで exit code 1 で終了する。
 *
 * LISTENING でなければ exit 0 (正常起動に進む)。
 */

import { createServer } from "node:net";

const PORTS = [5173, 5179];

/**
 * 指定 port が LISTENING 中かを probe する。
 * - EADDRINUSE: 既に使用中 → true
 * - その他 / 成功: 未使用 → false
 */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    server.once("listening", () => {
      server.close(() => resolve(false));
    });
    server.listen(port, "0.0.0.0");
  });
}

const results = await Promise.all(PORTS.map(async (port) => ({ port, inUse: await isPortInUse(port) })));
const occupied = results.filter((r) => r.inUse);

if (occupied.length > 0) {
  for (const { port } of occupied) {
    console.error(
      `\x1b[31m[check-ports]\x1b[0m Port ${port} はすでに使用中です。` +
      ` 起動済みのプロセスを確認してください (例: 前回の \`npm run dev\` が残っている)。` +
      ` 終了させてから再実行してください。`,
    );
  }
  process.exit(1);
}
