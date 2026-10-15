import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const dispatchNotify = vi.fn(async () => []);
vi.mock("./notifySend.js", () => ({ dispatchNotify: (...a: unknown[]) => (dispatchNotify as (...x: unknown[]) => unknown)(...a), sendWebhook: vi.fn(), isPrivateAddress: () => false }));
import { writeTable } from "../projectStorage.js";
import { addComment } from "./service.js";
import { notifyStore } from "./stores.js";
import { handleDesignTool } from "../handlers/design.js";

let ROOT = "";
const ts = "2026-01-01T00:00:00.000Z";
beforeEach(async () => {
  dispatchNotify.mockClear();
  ROOT = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ops-ai-notify-")));
  await fs.mkdir(path.join(ROOT, "harmony", "tables"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({ schemaVersion: "v3", dataDir: "harmony", meta: { id: "00000000-0000-4000-8000-00000000000c", name: "試験", createdAt: ts, updatedAt: ts }, entities: { tables: [] } }));
  await writeTable("orders", { id: "orders", uuid: "44444444-4444-4444-8444-444444444441", physicalName: "orders", name: "注文", createdAt: ts, updatedAt: ts, columns: [] }, ROOT);
  await notifyStore.update(ROOT, () => ({ version: 1, webhooks: [{ id: "h", name: "n", url: "https://hooks.example.com/x", format: "slack", events: ["comment"], enabled: true }] }));
});
afterEach(async () => { await fs.rm(ROOT, { recursive: true, force: true }); });
const settle = () => new Promise((r) => setTimeout(r, 50));

describe("コメントの通知", () => {
  it("人のコメントは、コメントの冒頭を添えて、1 件ごとに通知する", async () => {
    await addComment(ROOT, "花子", { target: { kind: "table", id: "orders" }, text: "桁数を確認してください" });
    await settle();
    expect(dispatchNotify).toHaveBeenCalledTimes(1);
    const msg = (dispatchNotify.mock.calls[0] as unknown as [unknown, { event: string; lines: string[] }])[1];
    expect(msg.event).toBe("comment");
    expect(msg.lines.join("\n")).toContain("桁数を確認してください");
  });

  it("AI の指摘 (MCP) は、件数だけの 1 通にまとめる (指摘の文は、外へ送らない)。指摘がなければ (重複だけ) 送らない", async () => {
    const f = (n: number) => ({ kind: "table", id: "orders", path: `columns[${n}]`, message: `秘密の内容 ${n}` });
    const res = await handleDesignTool("designer__add_review_findings", { findings: [f(0), f(1), f(2)] }, ROOT, "s") as { content: Array<{ text: string }> };
    expect(JSON.parse(res.content[0].text).added).toBe(3);
    await settle();
    expect(dispatchNotify).toHaveBeenCalledTimes(1);
    const msg = (dispatchNotify.mock.calls[0] as unknown as [unknown, { title: string; lines: string[] }])[1];
    expect(msg.title).toContain("3 件");
    expect(JSON.stringify(msg)).not.toContain("秘密の内容");
    dispatchNotify.mockClear();
    await handleDesignTool("designer__add_review_findings", { findings: [f(0)] }, ROOT, "s");
    await settle();
    expect(dispatchNotify).not.toHaveBeenCalled();
  });
});
