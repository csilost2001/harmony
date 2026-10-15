/**
 * Webhook の送信。外へ出す操作なので、守りを固める:
 * - https のみ。URL に資格情報を含めない (shared の checkWebhookUrl)
 * - 名前解決の結果が、社内・ローカルのアドレス (10/8・172.16/12・192.168/16・127/8・169.254/16・CGNAT・IPv6 のローカル) なら送らない。
 *   検査したアドレスへそのまま接続する (検査のあとで別のアドレスへ向く DNS リバインディングを防ぐ)
 * - リダイレクトは追わない・時間 (10 秒)・応答の読み取り (64 KB) に上限
 * - 本文は、構造化した文面だけ (設計の中身そのものは送らない。名前・状態・件数)
 */
import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import { buildPayload, checkWebhookUrl, type NotifyMessage, type Webhook } from "@harmony/shared";
import { logWarn } from "../serverLog.js";

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff");
  }
  return true;
}

export interface SendDeps {
  lookup: (host: string) => Promise<Array<{ address: string; family: number }>>;
  post: (o: { url: URL; address: string; family: number; body: string; timeoutMs: number }) => Promise<{ status: number }>;
}

const defaultDeps: SendDeps = {
  lookup: (host) => dns.lookup(host, { all: true }),
  post: ({ url, address, family, body, timeoutMs }) => new Promise((resolve, reject) => {
    const req = https.request({
      protocol: "https:", hostname: url.hostname, port: url.port || 443, path: `${url.pathname}${url.search}`, method: "POST", servername: url.hostname,
      headers: { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "user-agent": "harmony-notify/1" },
      // 検査したアドレスへ接続する
      lookup: (_h, _o, cb) => (_o && (_o as { all?: boolean }).all ? (cb as unknown as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [{ address, family }]) : cb(null, address, family)),
      timeout: timeoutMs,
    }, (res) => {
      let n = 0;
      res.on("data", (c: Buffer) => { n += c.length; if (n > 64 * 1024) res.destroy(); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
      res.on("close", () => resolve({ status: res.statusCode ?? 0 }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("接続先が応答しません (10 秒)")));
    req.on("error", reject);
    req.end(body);
  }),
};

export async function sendWebhook(w: Pick<Webhook, "url" | "format">, message: NotifyMessage, deps: SendDeps = defaultDeps): Promise<{ ok: boolean; status?: number; error?: string }> {
  const bad = checkWebhookUrl(w.url);
  if (bad) return { ok: false, error: bad };
  const url = new URL(w.url);
  let addrs: Array<{ address: string; family: number }>;
  try { addrs = await deps.lookup(url.hostname); } catch (e) { return { ok: false, error: `ホスト名を解決できません (${e instanceof Error ? e.message : String(e)})` }; }
  if (!addrs.length) return { ok: false, error: "ホスト名を解決できません" };
  if (addrs.some((a) => isPrivateAddress(a.address))) return { ok: false, error: "社内・ローカルのアドレスへは送れません" };
  try {
    const { status } = await deps.post({ url, address: addrs[0].address, family: addrs[0].family, body: JSON.stringify(buildPayload(w.format, message)), timeoutMs: 10_000 });
    return status >= 200 && status < 300 ? { ok: true, status } : { ok: false, status, error: `接続先がエラーを返しました (${status})` };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** 登録された通知先のうち、そのイベントを受けるものへ送る。失敗は記録するだけで、元の操作は止めない */
export async function dispatchNotify(webhooks: readonly Webhook[], message: NotifyMessage, deps?: SendDeps): Promise<Array<{ id: string; ok: boolean; error?: string }>> {
  const targets = webhooks.filter((w) => w.enabled && w.events.includes(message.event));
  return Promise.all(targets.map(async (w) => {
    const r = await sendWebhook(w, message, deps);
    if (!r.ok) logWarn("notify", "通知を送れませんでした", { webhook: w.id, error: r.error });
    return { id: w.id, ok: r.ok, ...(r.error ? { error: r.error } : {}) };
  }));
}
