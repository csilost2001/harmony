/**
 * generate-code の NestJS 開発コンテナの雛形の「DB ごとのブロック」の検査 (#1560)。
 *
 * 雛形 (nestjs-thymeleaf / nestjs-nextjs) の docker-compose.yml・.devcontainer/compose.yml・Dockerfile・README.snippet.md には、
 * `techStack.database.type` (postgresql / mysql / sqlite) と `techStack.backend.orm` (prisma / typeorm) ごとのブロックが全部入っている。
 * AI が SKILL.md の規則 (合うブロックを残し、合わないブロックを中身ごと消す) で写す。この規則を機械的に適用して、
 * 組合せ × DB × ORM の全部で、結果が正しい形になること・2 つの ORM が混ざらないことを確かめる。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TEMPLATES = path.join(REPO, "ai-skills/generate-code/templates/devcontainer");
const COMBOS = ["nestjs-nextjs", "nestjs-thymeleaf"] as const;
const DBS = ["sqlite", "postgresql", "mysql"] as const;
const ORMS = ["prisma", "typeorm"] as const;
type Ctx = { db: string; orm: string };

const read = (combo: string, rel: string) => fs.readFileSync(path.join(TEMPLATES, combo, rel), "utf8");

/** SKILL.md「DB ごとのブロック」の規則 1〜5 をそのまま適用する */
function prune(text: string, ctx: Ctx): string {
  const out: string[] = [];
  const stack: boolean[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    const open = t.match(/^(?:#|<!--)\s*@(db|orm)\s+([a-z0-9,]+)\s*(?:-->)?$/);
    if (open) {
      stack.push(open[2].split(",").includes(ctx[open[1] as keyof Ctx]));
      continue;
    }
    if (/^(?:#|<!--)\s*@end-(db|orm)\s*(?:-->)?$/.test(t)) {
      if (stack.length === 0) throw new Error("終了マーカーが多い");
      stack.pop();
      continue;
    }
    if (stack.every(Boolean)) out.push(line);
  }
  if (stack.length !== 0) throw new Error("開始マーカーに終了マーカーが無い");
  return out.join("\n");
}

const MARKER_LINE = /^\s*(?:#|<!--)\s*@(?:db|orm|end-db|end-orm)\b/m;

/** 同じ親の下に同じキーが 2 つある (YAML として重複) ものを探す。簡易 (インデントだけ見る。リスト項目の中は見ない) */
function duplicateKeys(yaml: string): string[] {
  const dups: string[] = [];
  const stack: { indent: number; keys: Set<string> }[] = [{ indent: -1, keys: new Set() }];
  for (const raw of yaml.split("\n")) {
    if (raw.trim() === "" || raw.trim().startsWith("#") || raw.trim().startsWith("-")) continue;
    const m = raw.match(/^(\s*)([A-Za-z0-9_.-]+):/);
    if (!m) continue;
    const indent = m[1].length;
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    let top = stack[stack.length - 1];
    if (top.indent < indent) {
      top = { indent, keys: new Set() };
      stack.push(top);
    }
    if (top.keys.has(m[2])) dups.push(`${m[2]} (行: ${raw.trim()})`);
    top.keys.add(m[2]);
  }
  return dups;
}

/** compose の top-level volumes: に宣言された名前と、services の volumes: で使われる名前付きボリューム */
function volumeNames(yaml: string): { declared: string[]; used: string[] } {
  const lines = yaml.split("\n");
  const declared: string[] = [];
  const used: string[] = [];
  let inTop = false;
  for (const l of lines) {
    if (/^volumes:/.test(l)) {
      inTop = true;
      continue;
    }
    if (/^\S/.test(l)) inTop = false;
    if (inTop) {
      const m = l.match(/^\s+([A-Za-z0-9_-]+):/);
      if (m) declared.push(m[1]);
    }
    const u = l.match(/^\s+-\s+([A-Za-z0-9_-]+):\//);
    if (u) used.push(u[1]);
  }
  return { declared, used };
}

describe.each(COMBOS)("雛形 %s の DB ごとのブロック (#1560)", (combo) => {
  it("マーカーの開始と終了が対応している (全ファイル)", () => {
    for (const f of ["docker-compose.yml", ".devcontainer/compose.yml", "Dockerfile", "README.snippet.md"]) {
      expect(() => prune(read(combo, f), { db: "sqlite", orm: "prisma" }), f).not.toThrow();
    }
  });

  describe.each(DBS)("database.type=%s", (db) => {
    describe.each(ORMS)("orm=%s", (orm) => {
      const ctx = { db, orm };
      const files = ["docker-compose.yml", ".devcontainer/compose.yml", "Dockerfile", "README.snippet.md"];

      it("ブロックを消した結果にマーカーの行が残らない", () => {
        for (const f of files) expect(MARKER_LINE.test(prune(read(combo, f), ctx)), f).toBe(false);
      });

      it("compose.yml 2 つ: キーが重ならず、使うボリュームが宣言されている", () => {
        for (const f of ["docker-compose.yml", ".devcontainer/compose.yml"]) {
          const y = prune(read(combo, f), ctx);
          expect(duplicateKeys(y), `${f} の重複キー`).toEqual([]);
          const { declared, used } = volumeNames(y);
          for (const u of used) expect(declared, `${f}: ${u} が volumes に無い`).toContain(u);
        }
      });

      it("DB サービス (db) は postgresql / mysql のときだけあり、app / dev がそれを待つ", () => {
        const prod = prune(read(combo, "docker-compose.yml"), ctx);
        const dev = prune(read(combo, ".devcontainer/compose.yml"), ctx);
        const hasDb = db !== "sqlite";
        expect(/^ {2}db:/m.test(prod)).toBe(hasDb);
        expect(/^ {2}db:/m.test(dev)).toBe(hasDb);
        expect(/condition: service_healthy/.test(prod)).toBe(hasDb);
        expect(/condition: service_healthy/.test(dev)).toBe(hasDb);
        if (db === "postgresql") {
          expect(prod).toContain("postgresql://app:app@db:5432/app");
          expect(dev).toContain("postgresql://app:app@db:5432/app");
          expect(prod).toContain("image: postgres:15");
        }
        if (db === "mysql") {
          expect(prod).toContain("mysql://app:app@db:3306/app");
          expect(dev).toContain("mysql://app:app@db:3306/app");
          expect(prod).toContain("image: mysql:8");
        }
        if (db === "sqlite") {
          expect(prod).toContain(orm === "prisma" ? "file:./dev.db" : "file:./data/dev.db");
        }
      });

      it("2 つの ORM が混ざらない (compose.yml・Dockerfile・README)", () => {
        const other = orm === "prisma" ? /typeorm|DB_SYNCHRONIZE|app-data|data\/dev\.db/i : /prisma/i;
        for (const f of files) {
          const out = prune(read(combo, f), ctx);
          expect(other.test(out), `${f} に ${orm === "prisma" ? "TypeORM" : "Prisma"} の記述が残っている`).toBe(false);
        }
      });

      it("Prisma は起動時の表づくり (db push) と Prisma Client の生成、TypeORM は DB_SYNCHRONIZE を持つ", () => {
        const prod = prune(read(combo, "docker-compose.yml"), ctx);
        const dockerfile = prune(read(combo, "Dockerfile"), ctx);
        if (orm === "prisma") {
          expect(prod).toContain("prisma db push");
          expect(dockerfile.match(/npx prisma generate/g)?.length).toBe(2); // builder と本番イメージ
        } else {
          expect(prod).toContain('DB_SYNCHRONIZE: "true"');
          expect(dockerfile).not.toMatch(/prisma/i);
        }
      });

      it("docker compose config が使えれば通る", () => {
        const probe = spawnSync("docker", ["compose", "version"]);
        if (probe.error || probe.status !== 0) return; // docker が無い環境では確かめない
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harmony-compose-"));
        try {
          const prodFile = path.join(dir, "docker-compose.yml");
          fs.writeFileSync(prodFile, prune(read(combo, "docker-compose.yml"), ctx));
          fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM scratch\n");
          const r = spawnSync("docker", ["compose", "-f", prodFile, "config", "-q"], { cwd: dir, encoding: "utf8" });
          expect(r.status, r.stderr).toBe(0);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      });
    });
  });

  it("devcontainer.json と .mcp.json はブロックを持たない (そのまま写す)", () => {
    expect(MARKER_LINE.test(read(combo, ".devcontainer/devcontainer.json"))).toBe(false);
    expect(MARKER_LINE.test(read(combo, ".mcp.json"))).toBe(false);
  });
});
