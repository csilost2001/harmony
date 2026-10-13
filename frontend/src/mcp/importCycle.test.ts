/**
 * 循環 import の見張り。
 * codexClient.ts は、読み込み時に `new CodexBrowserClient(mcpBridge)` を実行する。mcpBridge.ts の依存の先から
 * codexClient.ts に届くと、「どのモジュールが先に読み込まれるか」しだいで "Cannot access 'mcpBridge' before initialization"
 * になり、画面が起動しなくなる (import を 1 行足しただけで起きる。ユニットテストでは気づけない)。
 * 値としての import (型だけの import は除く) をたどって、届かないことを確かめる。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

const cache = new Map<string, string[]>();
function valueImports(file: string): string[] {
  const hit = cache.get(file);
  if (hit) return hit;
  const src = fs.readFileSync(file, "utf-8");
  const out: string[] = [];
  // import / export ... from "..." と import "..." (import type / export type は除く。動的 import は起動時には読まれない)
  const re = /^\s*(?:import|export)\s+(?!type\b)(?:[^;'"]*?\sfrom\s+)?["']([^"']+)["']/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const r = resolveImport(file, m[1]);
    if (r) out.push(r);
  }
  cache.set(file, out);
  return out;
}

function findPath(start: string, target: string): string[] | null {
  const seen = new Set([start]);
  const queue: string[][] = [[start]];
  while (queue.length) {
    const p = queue.shift()!;
    for (const d of valueImports(p[p.length - 1])) {
      if (d === target) return [...p, d];
      if (!seen.has(d)) { seen.add(d); queue.push([...p, d]); }
    }
  }
  return null;
}

describe("循環 import", () => {
  it("mcpBridge の依存の先から、codexClient (読み込み時に mcpBridge を使う) に届かない", () => {
    const p = findPath(path.join(SRC, "mcp/mcpBridge.ts"), path.join(SRC, "codex/codexClient.ts"));
    expect(p ? p.map((x) => path.relative(SRC, x)).join(" -> ") : null).toBeNull();
  });

  it("(見張りの確認) 値の import をたどれる: mcpBridge は flowStore に届く", () => {
    expect(findPath(path.join(SRC, "mcp/mcpBridge.ts"), path.join(SRC, "store/flowStore.ts"))).not.toBeNull();
  });
});
