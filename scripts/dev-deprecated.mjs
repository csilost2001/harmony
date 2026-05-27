/**
 * scripts/dev-deprecated.mjs (#1400)
 *
 * `npm run dev` / `npm run restart` の deprecation 通知。
 * concurrently で frontend + backend を束ねる旧 script は #1400 で撤去された。
 * Ctrl+C が tsx watch の 4 段プロセスチェーンに阻まれて backend を停止できない
 * 不具合の根本対策として、各 server は別ターミナルで個別起動する運用に統一した。
 *
 * AGENTS.md が一貫して案内している「backend は常駐サーバ」(#302) 方針とも整合。
 */

const command = process.env.npm_lifecycle_event ?? "dev";

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

console.error("");
console.error(`${RED}${BOLD}✖ npm run ${command} は #1400 で撤去されました。${RESET}`);
console.error("");
console.error(`${YELLOW}理由:${RESET} concurrently → npm → tsx watch → node の 4 段プロセスチェーンが`);
console.error("       Ctrl+C で backend を停止できない不具合の根本原因のため。");
console.error("");
console.error(`${BOLD}移行先:${RESET} 各サーバを別ターミナルで個別起動してください。`);
console.error("");
console.error(`  ${CYAN}# ターミナル A (常駐、起動しっぱなしで OK)${RESET}`);
console.error(`  ${BOLD}npm run backend${RESET}`);
console.error("");
console.error(`  ${CYAN}# ターミナル B (開発中、Ctrl+C で頻繁に再起動)${RESET}`);
console.error(`  ${BOLD}npm run frontend${RESET}`);
console.error("");

if (command === "restart") {
  console.error(`${BOLD}再起動の代替:${RESET}`);
  console.error(`  ${BOLD}npm run restart:backend${RESET}   # port 5179 を kill → backend 再起動`);
  console.error(`  ${BOLD}npm run restart:frontend${RESET}  # port 5173 を kill → frontend 再起動`);
  console.error("");
}

console.error(`詳細: https://github.com/csilost2001/harmony/issues/1400`);
console.error("");

process.exit(1);
