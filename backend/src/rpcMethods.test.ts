/**
 * RPC の method 名の一覧 (shared/src/rpcMethods.ts) が、backend の handler と一致していること。
 * frontend の呼び出し (mcpBridge.request("...")) が、一覧にある名前だけであることも、ソースの走査で確かめる。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RPC_METHODS } from "@harmony/shared";
import { rpcHandlerMap } from "./wsHandlers/index.js";

/** index.ts が、動的に登録する method (registerBrowserHandler) */
const DYNAMIC_METHODS = ["client.log.flush"];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("RPC の method 名の一覧", () => {
  it("backend の handler と、一覧が一致する (足し忘れ・消し忘れが無い)", () => {
    const handlers = [...rpcHandlerMap.keys(), ...DYNAMIC_METHODS].sort();
    expect([...RPC_METHODS].sort()).toEqual(handlers);
    expect(new Set(RPC_METHODS).size).toBe(RPC_METHODS.length); // 重複なし
  });

  it("frontend が文字列で呼ぶ method は、すべて一覧にある (handler の無い method を呼んでいない)", () => {
    const known = new Set<string>(RPC_METHODS);
    const re = /\.request\(\s*["'`]([A-Za-z0-9_.]+)["'`]/g;
    const unknown: string[] = [];
    for (const f of walk(path.resolve(__dirname, "../../frontend/src"))) {
      const src = fs.readFileSync(f, "utf-8");
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) if (!known.has(m[1])) unknown.push(`${path.relative(process.cwd(), f)}: ${m[1]}`);
    }
    expect(unknown).toEqual([]);
  });
});
