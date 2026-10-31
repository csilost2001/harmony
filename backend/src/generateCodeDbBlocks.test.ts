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
import { DB_VERSION_TOKEN, applyDbVersion, dropEmptyComposeKeys, isUsableDbVersion, resolveDbVersion } from "./ops/scaffoldBlocks.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TEMPLATES = path.join(REPO, "ai-skills/generate-code/templates/devcontainer");
const COMBOS = ["nestjs-nextjs", "nestjs-thymeleaf"] as const;
const DBS = ["sqlite", "postgresql", "mysql"] as const;
const ORMS = ["prisma", "typeorm"] as const;
type Ctx = { db: string; orm: string; dbVersion?: string };

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
          // 本番用: DB のファイルは data/ (ボリューム app-data)。ボリュームは schema.prisma のある prisma/ に載せない (古い schema が見えて db push が使うため)
          expect(prod).toContain(orm === "prisma" ? "file:../data/dev.db" : "file:./data/dev.db");
          expect(prod).toContain("app-data:/app/data");
          expect(prod).not.toMatch(/prisma-data|:\/app\/prisma/);
          // 開発用: Prisma は prisma/dev.db (schema.prisma 相対の ./dev.db)、TypeORM は data/dev.db
          expect(dev).toContain(orm === "prisma" ? "file:./dev.db" : "file:./data/dev.db");
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
        const other = orm === "prisma" ? /typeorm|DB_SYNCHRONIZE/i : /prisma/i;
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

describe("剪定の規則の境界 (#1560)", () => {
  const ctx = { db: "sqlite", orm: "prisma" };
  it("マーカーの種類と名前は大文字小文字を区別しない", () => {
    expect(pruneScaffoldBlocks("a\n# @DB SQLite\nb\n# @END-DB\n# @orm TypeORM\nc\n# @end-orm\n", ctx)).toBe("a\nb\n");
  });
  it("開始と終了の種類が違うときは Error (db で開いて orm で閉じる)", () => {
    expect(() => pruneScaffoldBlocks("# @db sqlite\nx\n# @end-orm\n", ctx)).toThrow(/種類が違う/);
  });
  it("終了が多い・足りないときは Error", () => {
    expect(() => pruneScaffoldBlocks("# @end-db\n", ctx)).toThrow(/終了マーカーが多い/);
    expect(() => pruneScaffoldBlocks("# @db sqlite\nx\n", ctx)).toThrow(/終了マーカーが無い/);
  });
  it("入れ子は、外側が一致しなければ内側ごと消える", () => {
    const text = "# @db mysql\n# @orm prisma\nM\n# @end-orm\n# @end-db\nkeep\n";
    expect(pruneScaffoldBlocks(text, ctx)).toBe("keep\n");
  });
  it("規則 6: 同じインデントの `- ` 行も子として数える (リスト形式の volumes を消さない)", () => {
    const yml = "services:\n  app:\n    volumes:\n    - a:/a\n    image: x\n";
    expect(dropEmptyComposeKeys(yml)).toBe(yml);
    expect(dropEmptyComposeKeys("services:\n  app:\n    volumes:\n    image: x\n")).toBe("services:\n  app:\n    image: x\n");
  });
});

describe("DB の版 (techStack.database.version) の置き換え (#1587)", () => {
  const imageOf = (yml: string): string | undefined => {
    const db = asMap(asMap(asMap(parseYaml(yml)).services).db);
    return db.image as string | undefined;
  };
  const FILES = ["docker-compose.yml", ".devcontainer/compose.yml"] as const;

  it("雛形には印 (__DB_VERSION__) が入り、版の数字は直書きしない (image の行と README の DB の行)", () => {
    for (const combo of COMBOS) {
      for (const f of FILES) {
        const t = read(combo, f);
        expect(t).toContain(`image: postgres:${DB_VERSION_TOKEN}`);
        expect(t).toContain(`image: mysql:${DB_VERSION_TOKEN}`);
        expect(t).not.toMatch(/image: (?:postgres|mysql):\d/);
      }
      const readme = read(combo, "README.snippet.md");
      expect(readme).toContain(`PostgreSQL ${DB_VERSION_TOKEN}`);
      expect(readme).toContain(`MySQL ${DB_VERSION_TOKEN}`);
    }
  });

  describe.each(COMBOS)("%s", (combo) => {
    it.each([["postgresql", "16", "postgres:16"], ["postgresql", undefined, "postgres:15"], ["postgresql", "16.4", "postgres:16.4"], ["mysql", "8.4", "mysql:8.4"], ["mysql", undefined, "mysql:8"], ["mysql", "5.7", "mysql:5.7"], ["postgresql", "16-alpine", "postgres:16-alpine"], ["postgresql", "16.4-bookworm", "postgres:16.4-bookworm"], ["mysql", "8.4-oracle", "mysql:8.4-oracle"], ["postgresql", "016", "postgres:016"], ["postgresql", "16-alpine3", "postgres:16-alpine3"]] as const)(
      "%s × version=%s: 2 つの compose.yml の DB の image が %s で、YAML として妥当・印が残らない",
      (db, version, image) => {
        for (const orm of ORMS) {
          for (const f of FILES) {
            const out = prune(f, read(combo, f), { db, orm, dbVersion: version });
            expect(imageOf(out), `${f}`).toBe(image);
            expect(out).not.toContain(DB_VERSION_TOKEN);
            checkCompose(`${combo}/${f}`, out);
          }
          const readme = prune("README.snippet.md", read(combo, "README.snippet.md"), { db, orm, dbVersion: version });
          expect(readme).not.toContain(DB_VERSION_TOKEN);
          expect(readme).toContain(`${db === "postgresql" ? "PostgreSQL" : "MySQL"} ${image.split(":")[1]}。`);
        }
      },
    );

    it.each(["latest", "16; rm -rf /", "", " ", "16 && x", "v16", "16.", ".16", "1e2", "16\nx", "16-", "16--a", "-a", "-16", "16-Alpine", "16;x", "16-alpine;x", "16-alpine-x", "16_a", "16-1a", "16$x", "16 alpine", "1".repeat(33), `16-${"a".repeat(31)}`, "__DB_VERSION__", 16 as unknown as string, null as unknown as string, { a: 1 } as unknown as string])(
      "不正な version (%j) は既定 (postgres:15 / mysql:8) に戻る",
      (version) => {
        for (const [db, image] of [["postgresql", "postgres:15"], ["mysql", "mysql:8"]] as const) {
          for (const f of FILES) {
            const out = prune(f, read(combo, f), { db, orm: "prisma", dbVersion: version });
            expect(imageOf(out), `${db} ${f}`).toBe(image);
            expect(out).not.toContain(DB_VERSION_TOKEN);
          }
        }
      },
    );

    it("sqlite / sqlserver / oracle は version を指定しても変わらない (DB サービスが無い。印も残らない)", () => {
      for (const db of ["sqlite", "sqlserver", "oracle"]) {
        for (const f of [...FILES, "README.snippet.md"]) {
          const withV = prune(f, read(combo, f), { db, orm: "typeorm", dbVersion: "16" });
          const without = prune(f, read(combo, f), { db, orm: "typeorm" });
          expect(withV).toBe(without);
          expect(withV).not.toContain(DB_VERSION_TOKEN);
          expect(withV).not.toMatch(/postgres:|mysql:/);
        }
      }
    });

    it("version の置き換えは ORM のブロックの剪定と共存する (置き換えるのは印だけ。ほかの行は version の有無で変わらない)", () => {
      for (const orm of ORMS) {
        for (const f of FILES) {
          const a = prune(f, read(combo, f), { db: "postgresql", orm, dbVersion: "16" });
          const b = prune(f, read(combo, f), { db: "postgresql", orm });
          expect(a.replace("postgres:16", "postgres:15")).toBe(b);
          expect(orm === "prisma" ? /typeorm|DB_SYNCHRONIZE/i.test(a) : /prisma/i.test(a)).toBe(false); // もう片方の ORM が混ざらない
        }
      }
    });
  });

  it("版の形: 数字とドット + 小文字英数字のサフィックス 1 つ。全体 32 文字まで (境界)", () => {
    expect(isUsableDbVersion("1".repeat(32))).toBe(true);
    expect(isUsableDbVersion("1".repeat(33))).toBe(false);
    expect(isUsableDbVersion(`16-${"a".repeat(29)}`)).toBe(true); // 32 文字
    expect(isUsableDbVersion(`16-${"a".repeat(30)}`)).toBe(false); // 33 文字
    expect(isUsableDbVersion("16-alpine")).toBe(true);
    expect(isUsableDbVersion(" 16-alpine ")).toBe(true);
    expect(isUsableDbVersion("016")).toBe(true); // 先頭 0 は docker のタグとして有効なので通す
    for (const bad of ["", " ", "16-", "16--a", "-a", "16-Alpine", "16;x", "latest", "16-alpine;x", null, undefined, 16, {}, []]) expect(isUsableDbVersion(bad), String(bad)).toBe(false);
  });

  it("database.type が Object.prototype の名前でも既定を取り違えない (__proto__ / constructor / toString)", () => {
    for (const db of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      expect(resolveDbVersion(db, "16"), db).toBeUndefined();
      expect(resolveDbVersion(db, undefined), db).toBeUndefined();
      expect(resolveDbVersion(db, { a: 1 }), db).toBeUndefined();
      expect(applyDbVersion(`x ${DB_VERSION_TOKEN}`, { db, orm: "prisma", dbVersion: "16" }), db).toBe(`x ${DB_VERSION_TOKEN}`);
    }
  });

  it("applyDbVersion / resolveDbVersion の規則: 印を全部置き換える・前後の空白は落とす・既定の無い DB は置き換えない", () => {
    expect(applyDbVersion(`a ${DB_VERSION_TOKEN} b ${DB_VERSION_TOKEN}`, { db: "postgresql", orm: "prisma", dbVersion: " 16 " })).toBe("a 16 b 16");
    expect(applyDbVersion(`x ${DB_VERSION_TOKEN}`, { db: "sqlite", orm: "prisma", dbVersion: "16" })).toBe(`x ${DB_VERSION_TOKEN}`);
    expect(resolveDbVersion("PostgreSQL", "17")).toBe("17");
    expect(resolveDbVersion("postgresql", undefined)).toBe("15");
    expect(resolveDbVersion("mysql", 8)).toBe("8");
    expect(resolveDbVersion("sqlite", "3")).toBeUndefined(); // DB サービスの無い DB は、指定があっても使わない
    expect(resolveDbVersion("sqlite", undefined)).toBeUndefined();
  });
});
