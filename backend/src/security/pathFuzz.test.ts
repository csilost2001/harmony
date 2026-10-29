/**
 * パスの検査のランダム入力テスト (S-002 の継続的な確認)。
 * 乱数 (固定の種) と典型的な攻撃文字列を id・ファイル名・種類名・版の ID に入れ、
 * 「通った値はワークスペースの外を指さない」「ワークスペースの外にファイルができない」ことを確かめる。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { assertEntityId, assertHistoryId, assertKind, assertPathContained, assertSafeName, isValidEntityId, isValidSafeName } from "./idValidator.js";
import { assertRelPath } from "../fileBackup.js";
import { ensureDataDir, harmonyFile, writeTable, writeGenericDefinition, readTable, deleteTable } from "../projectStorage.js";
import { readEntityVersion, versionedRelPath } from "../fileVersions.js";

/** 固定の種の乱数 (再現できる) */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
}
const ALPHABET = ["a", "b", "z", "0", "9", "-", "_", ".", "..", "/", "\\", "%2e", "%2f", "%5c", ":", "~", " ", "\u0000", "\n", "あ", "ｱ", "\u202e", "$", "*", "?", "..%2f", "....//", "C:\\", "\\\\srv\\x"];
function randomString(r: () => number, maxLen = 24): string {
  const n = 1 + Math.floor(r() * maxLen);
  let out = "";
  for (let i = 0; i < n; i++) out += ALPHABET[Math.floor(r() * ALPHABET.length)];
  return out;
}
const ATTACKS = [
  "../x", "..\\x", "a/../../x", "/etc/passwd", "C:\\Windows\\x", "\\\\srv\\share\\x", "%2e%2e%2fx", "..%2fx", "tables/../../escape", "a\u0000b", ".", "..", "...", "a/b", "a\\b",
  "x".repeat(300), "", " ", "-a", "A-B", "con", "aux", "a.json", "a.b",
];

const TMP = path.join(os.tmpdir(), `path-fuzz-${process.pid}-${Date.now()}`);
const WS = path.join(TMP, "ws");

async function listAll(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    out.push(p);
    if (e.isDirectory()) out.push(...await listAll(p));
  }
  return out.sort();
}

beforeAll(async () => {
  await fs.mkdir(WS, { recursive: true });
  await fs.writeFile(harmonyFile(WS), JSON.stringify({ schemaVersion: "v3", dataDir: "harmony", meta: { id: "fuzz", name: "f", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, extensionsApplied: [], entities: {} }));
  await ensureDataDir(WS, "harmony");
});
afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

describe("ID の検査 (ランダム入力)", () => {
  const r = rng(20261013);
  const inputs = [...ATTACKS, ...Array.from({ length: 2000 }, () => randomString(r))];

  it("検査を通った id / 名前は、区切り文字・.. ・NUL を含まず、結合してもその場所に収まる", () => {
    let passed = 0;
    for (const s of inputs) {
      for (const [ok, assertFn] of [[isValidEntityId(s), assertEntityId], [isValidSafeName(s), assertSafeName]] as const) {
        if (!ok) { expect(() => assertFn(s, "id"), JSON.stringify(s)).toThrow(); continue; }
        passed++;
        expect(s).not.toMatch(/[\\/\u0000]|\.\./);
        const joined = path.join("/ws/tables", `${s}.json`);
        expect(path.dirname(joined)).toBe("/ws/tables");
      }
    }
    expect(passed).toBeGreaterThan(0); // 検査が全部を拒否するだけの空振りではない
  });

  it("種類名・履歴 ID も同様 (通ったものは、区切り文字・.. を含まない)", () => {
    for (const s of inputs) {
      for (const fn of [assertKind, assertHistoryId]) {
        let ok = true;
        try { fn(s, "x"); } catch { ok = false; }
        if (ok) expect(s, JSON.stringify(s)).not.toMatch(/[\\/\u0000]|\.\./);
      }
    }
  });

  it("assertPathContained: 外へ出る結合は、どんな入力でも拒否する", () => {
    const root = path.join(TMP, "root");
    for (const s of inputs) {
      const target = path.join(root, "a", s);
      const inside = path.relative(root, target);
      if (inside.startsWith("..") || path.isAbsolute(inside)) expect(() => assertPathContained(target, root), JSON.stringify(s)).toThrow();
      else expect(assertPathContained(target, root)).toBeTruthy();
    }
  });
});

describe("保存・削除・版の読み出し (ランダム入力でも、ワークスペースの外に触れない)", () => {
  it("writeTable / readTable / deleteTable / writeGenericDefinition に不正な id を渡しても、外にファイルができない", async () => {
    const before = await listAll(TMP);
    const r = rng(77);
    const ids = [...ATTACKS, ...Array.from({ length: 150 }, () => randomString(r, 12))];
    for (const id of ids) {
      await writeTable(id, { id, name: "x", columns: [] }, WS).catch(() => undefined);
      await readTable(id, WS).catch(() => undefined);
      await deleteTable(id, WS).catch(() => undefined);
      await writeGenericDefinition(id, "message", { id, name: "x" }, WS).catch(() => undefined);
    }
    const after = await listAll(TMP);
    const created = after.filter((p) => !before.includes(p));
    for (const p of created) {
      const rel = path.relative(WS, p);
      expect(rel.startsWith(".."), `外にできたファイル: ${p}`).toBe(false);
    }
    // ワークスペースの外 (TMP 直下) に、ws 以外ができていない
    expect((await fs.readdir(TMP)).sort()).toEqual(["ws"]);
  });

  it("版の ID・相対パス: 外へ出る値は拒否する", async () => {
    const r = rng(5);
    for (const s of [...ATTACKS, ...Array.from({ length: 300 }, () => randomString(r))]) {
      let ok = true;
      try { assertRelPath(s); } catch { ok = false; }
      if (ok) {
        const abs = path.resolve(WS, ...s.split("/"));
        expect(path.relative(WS, abs).startsWith(".."), JSON.stringify(s)).toBe(false);
      }
      await readEntityVersion(WS, "table", "x", s).then(() => { throw new Error(`通ってはいけない: ${JSON.stringify(s)}`); }, () => undefined);
      await versionedRelPath(WS, "table", s).then((rel) => expect(rel.startsWith(".."), rel).toBe(false), () => undefined);
    }
  });
});
