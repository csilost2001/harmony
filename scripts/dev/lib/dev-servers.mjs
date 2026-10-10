/**
 * dev-servers — ui-shots / theme-audit が使う「必要なら dev server を起動し、終わったら止める」補助。
 *
 * すでに 5173 (frontend) / 5179 (backend) が起動していればそのまま使い、止めない。
 * 起動していなければこのスクリプトが起動し、終了時 (正常・失敗・Ctrl+C) に自分が起動したものだけ止める。
 * これにより `npm run ui:audit` / `npm run ui:shots` を、サーバを別に立てずに 1 コマンドで実行できる。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PORTS = { backend: 5179, frontend: 5173 };

const listening = (port) => new Promise((resolve) => {
  const s = net.connect({ port, host: "127.0.0.1" });
  s.once("connect", () => { s.destroy(); resolve(true); });
  s.once("error", () => resolve(false));
  s.setTimeout(500, () => { s.destroy(); resolve(false); });
});

async function waitFor(port, label, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await listening(port)) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${label} (port ${port}) が ${ms / 1000} 秒以内に起動しませんでした。ログ: .tmp/dev-servers-${label}.log`);
}

/**
 * @returns {Promise<{ stop: () => void, started: string[] }>} stop() は自分が起動したものだけ止める
 */
export async function ensureDevServers() {
  const children = [];
  const started = [];
  const logDir = path.join(root, ".tmp");
  fs.mkdirSync(logDir, { recursive: true });

  const launch = (label, script, env = {}) => {
    const log = fs.openSync(path.join(logDir, `dev-servers-${label}.log`), "w");
    // detached = 独自のプロセスグループ。tsx watch / vite の子プロセスごとまとめて止めるため
    const child = spawn("npm", ["run", script], { cwd: root, detached: true, stdio: ["ignore", log, log], env: { ...process.env, ...env } });
    children.push(child);
    started.push(label);
  };

  if (!(await listening(PORTS.backend))) {
    // ワークスペースの選択画面から repo 配下のフォルダを開けるようにする (既定は利用者のホームだけ)
    launch("backend", "backend", { HARMONY_ALLOWED_BROWSE_ROOTS: [root, process.env.HOME ?? ""].filter(Boolean).join(path.delimiter) });
  }
  if (!(await listening(PORTS.frontend))) launch("frontend", "frontend");

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const c of children) {
      try { process.kill(-c.pid, "SIGTERM"); } catch { /* すでに終了 */ }
    }
    // tsx watch の孫プロセスが残ることがあるため、自分が起動したポートだけ確実に空ける
    for (const l of started) spawn("node", ["scripts/kill-ports.mjs", "--port", String(PORTS[l])], { cwd: root, stdio: "ignore" });
  };
  for (const sig of ["SIGINT", "SIGTERM"]) process.once(sig, () => { stop(); process.exit(130); });
  process.once("exit", stop);

  try {
    if (started.length) console.log(`dev server を起動します: ${started.join(", ")} (終了時に止めます)`);
    await Promise.all([waitFor(PORTS.backend, "backend"), waitFor(PORTS.frontend, "frontend")]);
  } catch (e) {
    stop();
    throw e;
  }
  return { stop, started };
}

/** 指定のワークスペースがなければ、examples/retail の複製を .tmp に作って返す (画面の確認用) */
export function resolveWorkspace(requested) {
  const want = path.resolve(requested);
  if (fs.existsSync(path.join(want, "harmony.json"))) return want;
  const fallback = path.join(root, ".tmp", "ui-workspace", "retail");
  if (!fs.existsSync(path.join(fallback, "harmony.json"))) {
    fs.mkdirSync(path.dirname(fallback), { recursive: true });
    fs.cpSync(path.join(root, "examples", "retail"), fallback, { recursive: true });
  }
  console.log(`ワークスペース ${requested} がないため、examples/retail の複製 (${path.relative(root, fallback)}) を使います`);
  return fallback;
}
