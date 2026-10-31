/**
 * generate-code の NestJS 開発コンテナの雛形の「DB ごとのブロック」の検査 (#1560)。
 *
 * 雛形 (nestjs-thymeleaf / nestjs-nextjs) の docker-compose.yml・.devcontainer/compose.yml・Dockerfile・README.snippet.md には、
 * `techStack.database.type` (postgresql / mysql / sqlite) と `techStack.backend.orm` (prisma / typeorm) ごとのブロックが全部入っている。
 * AI が SKILL.md の規則 (合うブロックを残し、合わないブロックを中身ごと消す) で写す。この規則を機械的に適用して、
 * 組合せ × DB × ORM の全部で、結果が正しい形になること・2 つの ORM が混ざらないことを確かめる。
 *
 * ブロックを消す規則は `backend/src/ops/scaffold*.ts` の関数を使う (雛形の更新の比較と同じ実装。ここに自前の実装は持たない)。
 * YAML は docker が無くても確かめられるよう、この試験の中の小さな読み取り (`parseYaml`) で構造を見る。docker があれば、さらに `docker compose config` も通す。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BLOCK_MARKER_LINE, pruneScaffoldBlocks, pruneScaffoldFile } from "./ops/scaffold.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TEMPLATES = path.join(REPO, "ai-skills/generate-code/templates/devcontainer");
const COMBOS = ["nestjs-nextjs", "nestjs-thymeleaf"] as const;
const DBS = ["sqlite", "postgresql", "mysql"] as const;
const ORMS = ["prisma", "typeorm"] as const;
type Ctx = { db: string; orm: string };

const read = (combo: string, rel: string) => fs.readFileSync(path.join(TEMPLATES, combo, rel), "utf8");
const prune = (rel: string, text: string, ctx: Ctx) => pruneScaffoldFile(rel, text, ctx);
const MARKER_LINE = BLOCK_MARKER_LINE;

/** 雛形で使う範囲の YAML (マップ・`- 値` のリスト・値は文字列のまま) を読む。同じ親の下の重複キー・タブ・値の無いキーでない空のキーは Error にする */
type Y = string | null | Y[] | { [k: string]: Y };
function parseYaml(text: string): Y {
  if (/\t/.test(text)) throw new Error("タブが含まれている");
  const lines = text.split("\n").map((raw) => ({ raw, indent: raw.length - raw.trimStart().length, t: raw.trim() })).filter((l) => l.t !== "" && !l.t.startsWith("#"));
  let i = 0;
  const block = (indent: number): Y => {
    if (lines[i].t.startsWith("- ")) {
      const list: Y[] = [];
      while (i < lines.length && lines[i].indent === indent && lines[i].t.startsWith("- ")) { list.push(lines[i].t.slice(2).trim()); i++; }
      return list;
    }
    const map: { [k: string]: Y } = {};
    while (i < lines.length && lines[i].indent === indent) {
      const m = lines[i].t.match(/^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/);
      if (!m) throw new Error(`キーとして読めない行: ${lines[i].raw}`);
      if (m[1] in map) throw new Error(`キーが重複している: ${m[1]}`);
      i++;
      if (m[2] !== undefined) map[m[1]] = m[2];
      else if (i < lines.length && lines[i].indent > indent) map[m[1]] = block(lines[i].indent);
      else map[m[1]] = null;
    }
    if (i < lines.length && lines[i].indent > indent) throw new Error(`インデントが合わない行: ${lines[i].raw}`);
    return map;
  };
  const out = block(lines[0].indent);
  if (i < lines.length) throw new Error(`読み残した行: ${lines[i].raw}`);
  return out;
}
const asMap = (y: Y | undefined): { [k: string]: Y } => {
  if (!y || typeof y !== "object" || Array.isArray(y)) throw new Error("マップでない");
  return y;
};

/** compose のファイルの構造の検査 (docker が無くても走る): services が image か build を持ち、値の無い environment / volumes / depends_on が無く、使う名前付きボリュームが宣言され、待つ service が在る */
function checkCompose(file: string, yaml: string): void {
  const top = asMap(parseYaml(yaml));
  const services = asMap(top.services);
  expect(Object.keys(services).length, `${file}: services が空`).toBeGreaterThan(0);
  const declared = top.volumes === undefined ? [] : top.volumes === null ? [] : Object.keys(asMap(top.volumes));
  expect(top.volumes === null, `${file}: top の volumes: が値の無いキー`).toBe(false);
  for (const [name, def] of Object.entries(services)) {
    const svc = asMap(def);
    expect(svc.image !== undefined || svc.build !== undefined || svc.network_mode !== undefined, `${file}: ${name} に image / build が無い`).toBe(true);
    for (const key of ["environment", "volumes", "depends_on", "ports"]) expect(svc[key] === null, `${file}: ${name}.${key} が値の無いキー`).toBe(false);
    if (Array.isArray(svc.volumes)) {
      for (const v of svc.volumes) {
        const named = String(v).match(/^"?([A-Za-z0-9_-]+):\//);
        if (named) expect(declared, `${file}: ${name} が使う ${named[1]} が volumes に無い`).toContain(named[1]);
      }
    }
    if (svc.depends_on && !Array.isArray(svc.depends_on)) for (const dep of Object.keys(asMap(svc.depends_on))) expect(Object.keys(services), `${file}: ${name} が待つ ${dep} が services に無い`).toContain(dep);
  }
}

const dockerAvailable = (() => {
  const probe = spawnSync("docker", ["compose", "version"]);
  return !probe.error && probe.status === 0;
})();

describe.each(COMBOS)("雛形 %s の DB ごとのブロック (#1560)", (combo) => {
  it("マーカーの開始と終了が対応している (全ファイル)", () => {
    for (const f of ["docker-compose.yml", ".devcontainer/compose.yml", ".devcontainer/devcontainer.json", "Dockerfile", "README.snippet.md"]) {
      expect(() => pruneScaffoldBlocks(read(combo, f), { db: "sqlite", orm: "prisma" }), f).not.toThrow();
    }
  });

  it("開始と終了が対応しない雛形は、剪定が Error にする (壊れた雛形を黙って通さない)", () => {
    expect(() => pruneScaffoldBlocks("# @db sqlite\nx\n", { db: "sqlite", orm: "prisma" })).toThrow();
    expect(() => pruneScaffoldBlocks("x\n# @end-db\n", { db: "sqlite", orm: "prisma" })).toThrow();
  });

  describe.each([...DBS, "sqlserver", "oracle"] as const)("database.type=%s", (db) => {
    describe.each(ORMS)("orm=%s", (orm) => {
      const ctx = { db, orm };
      const files = ["docker-compose.yml", ".devcontainer/compose.yml", "Dockerfile", "README.snippet.md"];
      const hasDb = db === "postgresql" || db === "mysql";

      it("ブロックを消した結果にマーカーの行が残らない", () => {
        for (const f of files) expect(MARKER_LINE.test(prune(f, read(combo, f), ctx)), f).toBe(false);
      });

      it("compose.yml 2 つが YAML の構造として妥当 (重複キー・値の無い environment / volumes が無い。使うボリュームが宣言され、待つ service がある)", () => {
        for (const f of ["docker-compose.yml", ".devcontainer/compose.yml"]) checkCompose(`${combo}/${f}`, prune(f, read(combo, f), ctx));
      });

      it("DB サービス (db) は postgresql / mysql のときだけあり、app / dev がそれを待つ。それ以外は DB の接続先 (DATABASE_URL) も書かない", () => {
        const prod = prune("docker-compose.yml", read(combo, "docker-compose.yml"), ctx);
        const dev = prune(".devcontainer/compose.yml", read(combo, ".devcontainer/compose.yml"), ctx);
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
        if (db === "sqlserver" || db === "oracle") {
          // DB サービスの雛形が無い: 接続先は利用者が決める (SKILL.md「DB と ORM の読み方」)。値の無いキーは残さない
          expect(prod).not.toMatch(/^\s+DATABASE_URL:/m);
          expect(dev).not.toMatch(/^\s+DATABASE_URL:/m);
          expect(prod).not.toMatch(/^\s*volumes:\s*$/m);
          expect(prod).not.toMatch(/^ {4}depends_on:/m);
        }
      });

      it("2 つの ORM が混ざらない (compose.yml・Dockerfile・README)", () => {
        const other = orm === "prisma" ? /typeorm|DB_SYNCHRONIZE|app-data|data\/dev\.db/i : /prisma/i;
        for (const f of files) {
          const out = prune(f, read(combo, f), ctx);
          expect(other.test(out), `${f} に ${orm === "prisma" ? "TypeORM" : "Prisma"} の記述が残っている`).toBe(false);
        }
      });

      it("Prisma は起動時の表づくり (db push) と Prisma Client の生成、TypeORM は DB_SYNCHRONIZE を持つ", () => {
        const prod = prune("docker-compose.yml", read(combo, "docker-compose.yml"), ctx);
        const dockerfile = prune("Dockerfile", read(combo, "Dockerfile"), ctx);
        if (orm === "prisma") {
          expect(prod).toContain("prisma db push");
          expect(dockerfile.match(/npx prisma generate/g)?.length).toBe(2); // builder と本番イメージ
        } else {
          expect(prod).toContain('DB_SYNCHRONIZE: "true"');
          expect(dockerfile).not.toMatch(/prisma/i);
        }
      });

      it("devcontainer.json: ブロックを消した結果が JSON として読め、Prisma の記述は prisma のときだけ残る", () => {
        const out = prune(".devcontainer/devcontainer.json", read(combo, ".devcontainer/devcontainer.json"), ctx);
        expect(MARKER_LINE.test(out)).toBe(false);
        const json = JSON.parse(out.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")) as {
          postCreateCommand: string;
          customizations?: { vscode?: { extensions?: string[] } };
        };
        expect(/prisma/i.test(out)).toBe(orm === "prisma");
        expect(json.postCreateCommand.includes("prisma generate")).toBe(orm === "prisma");
        expect(json.postCreateCommand).toContain("npm install -g @openai/codex");
        expect(json.postCreateCommand).toContain("playwright install --with-deps chromium");
        if (combo === "nestjs-nextjs") {
          expect(json.customizations?.vscode?.extensions?.includes("Prisma.prisma")).toBe(orm === "prisma");
        }
      });

      // docker があるときだけの追加の検査 (無い環境では、上の構造の検査が代わりに走る)
      it.skipIf(!dockerAvailable)("docker compose config が 2 つの compose.yml で通る (docker があるときだけ)", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harmony-compose-"));
        try {
          fs.mkdirSync(path.join(dir, ".devcontainer"));
          fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM scratch\n");
          for (const f of ["docker-compose.yml", ".devcontainer/compose.yml"]) {
            const file = path.join(dir, f);
            fs.writeFileSync(file, prune(f, read(combo, f), ctx));
            const r = spawnSync("docker", ["compose", "-f", file, "config", "-q"], { cwd: dir, encoding: "utf8" });
            expect(r.status, `${f}: ${r.stderr}`).toBe(0);
          }
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      });
    });
  });

  it("構造の検査が本当に壊れた YAML を検出する (偽陰性でない): 値の無い volumes:・重複キー・宣言の無いボリューム・待つ service が無い", () => {
    expect(() => checkCompose("x", "services:\n  app:\n    build: .\n    volumes:\nvolumes:\n  a:\n")).toThrow();
    expect(() => checkCompose("x", "services:\n  app:\n    build: .\n    image: y\n    build: .\n")).toThrow();
    expect(() => checkCompose("x", "services:\n  app:\n    build: .\n    volumes:\n      - data:/d\n")).toThrow();
    expect(() => checkCompose("x", "services:\n  app:\n    build: .\n    depends_on:\n      db:\n        condition: service_healthy\n")).toThrow();
    expect(() => checkCompose("x", "services:\n  app:\n    build: .\n    environment:\n")).toThrow();
    // 剪定の前の雛形そのもの (キーが重なる) は、構造の検査を通らない
    expect(() => checkCompose("x", read(combo, "docker-compose.yml"))).toThrow();
  });

  it(".mcp.json はブロックを持たない (そのまま写す)", () => {
    expect(MARKER_LINE.test(read(combo, ".mcp.json"))).toBe(false);
  });
});
