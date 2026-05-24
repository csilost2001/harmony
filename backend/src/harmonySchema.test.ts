/**
 * harmony.v3.schema.json 単体テスト (R-1 #850)
 *
 * harmony.json (workspace marker) の AJV バリデーションを検証する。
 * - 妥当な dataDir → pass
 * - 不正な dataDir → reject
 * - required フィールド欠落 → reject
 */
import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import fs from "node:fs/promises";
import path from "node:path";

const SCHEMAS_DIR = path.resolve(import.meta.dirname, "../../schemas");

type ValidateFn = ((data: unknown) => boolean) & { errors?: unknown };

let validate: ValidateFn;

beforeAll(async () => {
  const harmonySchema = JSON.parse(
    await fs.readFile(path.join(SCHEMAS_DIR, "v3", "harmony.v3.schema.json"), "utf-8"),
  );
  const commonSchema = JSON.parse(
    await fs.readFile(path.join(SCHEMAS_DIR, "v3", "common.v3.schema.json"), "utf-8"),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(commonSchema);
  validate = ajv.compile(harmonySchema) as ValidateFn;
});

/** 最小限の valid な harmony.json ベース
 *
 * #1294 I-2 / RFC #1284: meta.id を kebab-case EntityId に、uuid (UUID v4、不変) を required で追加。
 */
function makeBase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "v3",
    meta: {
      id: "test-project",
      uuid: "11111111-1111-4111-8111-111111111111",
      name: "テストプロジェクト",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    dataDir: "harmony",
    extensionsApplied: [],
    entities: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// dataDir: 妥当なケース
// ---------------------------------------------------------------------------
describe("dataDir: 妥当な値は AJV pass", () => {
  it("dataDir: 'harmony' (推奨デフォルト)", () => {
    expect(validate(makeBase({ dataDir: "harmony" }))).toBe(true);
  });

  it("dataDir: 'docs/harmony' (multi-segment path)", () => {
    expect(validate(makeBase({ dataDir: "docs/harmony" }))).toBe(true);
  });

  it("dataDir: '納品物' (日本語フォルダ名)", () => {
    expect(validate(makeBase({ dataDir: "納品物" }))).toBe(true);
  });

  it("dataDir: 'my-app/design' (ハイフン含む multi-segment)", () => {
    expect(validate(makeBase({ dataDir: "my-app/design" }))).toBe(true);
  });

  it("dataDir: 'a' (1 文字)", () => {
    expect(validate(makeBase({ dataDir: "a" }))).toBe(true);
  });

  it("dataDir: 'sub/sub2/sub3' (3 段ネスト)", () => {
    expect(validate(makeBase({ dataDir: "sub/sub2/sub3" }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dataDir: 不正なケース → reject
// ---------------------------------------------------------------------------
describe("dataDir: 不正な値は AJV reject", () => {
  it("dataDir: '' (空文字) → minLength: 1 で reject", () => {
    expect(validate(makeBase({ dataDir: "" }))).toBe(false);
  });

  it("dataDir: '.' (カレントディレクトリ) → reject", () => {
    expect(validate(makeBase({ dataDir: "." }))).toBe(false);
  });

  it("dataDir: '..' (親ディレクトリ) → reject", () => {
    expect(validate(makeBase({ dataDir: ".." }))).toBe(false);
  });

  it("dataDir: '../escape' (path traversal 先頭) → reject", () => {
    expect(validate(makeBase({ dataDir: "../escape" }))).toBe(false);
  });

  it("dataDir: 'a/../b' (中間 path traversal) → reject", () => {
    expect(validate(makeBase({ dataDir: "a/../b" }))).toBe(false);
  });

  it("dataDir: 'a/../../b' (深い path traversal) → reject", () => {
    expect(validate(makeBase({ dataDir: "a/../../b" }))).toBe(false);
  });

  it("dataDir: 'foo/..' (末尾 path traversal) → reject", () => {
    expect(validate(makeBase({ dataDir: "foo/.." }))).toBe(false);
  });

  it("dataDir: '../foo' (先頭 ../ セグメント) → reject", () => {
    expect(validate(makeBase({ dataDir: "../foo" }))).toBe(false);
  });

  it("dataDir: '/abs' (POSIX 絶対パス) → reject", () => {
    expect(validate(makeBase({ dataDir: "/abs" }))).toBe(false);
  });

  it("dataDir: '/abs/path' (POSIX 絶対パス 多段) → reject", () => {
    expect(validate(makeBase({ dataDir: "/abs/path" }))).toBe(false);
  });

  it("dataDir: 'C:\\\\path' (Windows バックスラッシュ形式) → reject", () => {
    expect(validate(makeBase({ dataDir: "C:\\path" }))).toBe(false);
  });

  it("dataDir: 'C:/path' (Windows ドライブレター + スラッシュ) → reject", () => {
    expect(validate(makeBase({ dataDir: "C:/path" }))).toBe(false);
  });

  it("dataDir: 'z:/windows' (小文字ドライブレター) → reject", () => {
    expect(validate(makeBase({ dataDir: "z:/windows" }))).toBe(false);
  });

  it("dataDir: 'harmony/' (末尾スラッシュ) → reject", () => {
    expect(validate(makeBase({ dataDir: "harmony/" }))).toBe(false);
  });

  it("dataDir: 'docs/harmony/' (multi-segment 末尾スラッシュ) → reject", () => {
    expect(validate(makeBase({ dataDir: "docs/harmony/" }))).toBe(false);
  });

  it("dataDir: '..foo' (dotfile 名は path traversal ではないので allow)", () => {
    // ".." セグメントではなく ".." で始まるファイル名は仕様上 OK (Unix dotfile 規約)
    expect(validate(makeBase({ dataDir: "..foo" }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// required フィールド欠落
// ---------------------------------------------------------------------------
describe("required フィールド欠落 → AJV reject", () => {
  it("dataDir が無い → reject", () => {
    const { dataDir: _removed, ...withoutDataDir } = makeBase() as { dataDir: unknown } & Record<string, unknown>;
    expect(validate(withoutDataDir)).toBe(false);
  });

  it("schemaVersion が無い → reject", () => {
    const { schemaVersion: _removed, ...without } = makeBase() as { schemaVersion: unknown } & Record<string, unknown>;
    expect(validate(without)).toBe(false);
  });

  it("meta が無い → reject", () => {
    const { meta: _removed, ...without } = makeBase() as { meta: unknown } & Record<string, unknown>;
    expect(validate(without)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// schemaVersion バリデーション
// ---------------------------------------------------------------------------
describe("schemaVersion バリデーション", () => {
  it("schemaVersion: 'v3' → pass", () => {
    expect(validate(makeBase({ schemaVersion: "v3" }))).toBe(true);
  });

  it("schemaVersion: 'v2' → reject (enum['v3'] のみ)", () => {
    expect(validate(makeBase({ schemaVersion: "v2" }))).toBe(false);
  });

  it("schemaVersion: '' → reject", () => {
    expect(validate(makeBase({ schemaVersion: "" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// entities オプション構造 (空でも full でも pass)
// ---------------------------------------------------------------------------
describe("entities は省略可、または空オブジェクト / 配列入り", () => {
  it("entities 省略 → pass", () => {
    const { entities: _removed, ...withoutEntities } = makeBase() as { entities: unknown } & Record<string, unknown>;
    expect(validate(withoutEntities)).toBe(true);
  });

  it("entities: {} → pass", () => {
    expect(validate(makeBase({ entities: {} }))).toBe(true);
  });

  it("entities.screens: [] → pass", () => {
    expect(validate(makeBase({ entities: { screens: [] } }))).toBe(true);
  });
});
