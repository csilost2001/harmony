/**
 * プロジェクト独自部品の schema (layout-components.v3.schema.json) と、画面 schema の部品参照 (type=component)。
 * サンプルの layout-components.json が schema と validateComponentDefs に通り、
 * それを使う画面が展開後に整合していること (存在しない項目・独自部品が無いこと) を確認する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildComponentDef, buildHarmonyAjv, suggestParams, validateComponentDefs, validateLayoutWithComponents, type LayoutComponentDef, type LayoutNode } from "@harmony/shared";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SCHEMAS = path.join(ROOT, "schemas", "v3");
const read = (p: string) => JSON.parse(fs.readFileSync(p, "utf-8"));

let ajv: ReturnType<typeof buildHarmonyAjv>;
beforeAll(() => {
  ajv = buildHarmonyAjv();
  for (const f of ["common.v3.schema.json", "screen-item.v3.schema.json", "screen.v3.schema.json", "layout-components.v3.schema.json"]) {
    ajv.addSchema(read(path.join(SCHEMAS, f)));
  }
});

const validateComponents = () => ajv.getSchema("https://raw.githubusercontent.com/csilost2001/harmony/main/schemas/v3/layout-components.v3.schema.json")!;
const validateScreen = () => ajv.getSchema("https://raw.githubusercontent.com/csilost2001/harmony/main/schemas/v3/screen.v3.schema.json")!;

const examples = fs.readdirSync(path.join(ROOT, "examples"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, "examples", d.name, "harmony.json")))
  .map((d) => d.name);

describe("layout-components.v3.schema", () => {
  const good = { version: 1, components: [{ id: "box", label: "箱", params: [{ id: "who", label: "項目", kind: "item" }], nodes: [{ id: "f", type: "field", itemRef: "{{who}}" }] }] };

  it("正しい定義を受け付け、不正な ID・種類・未知のプロパティを拒否する", () => {
    expect(validateComponents()(good)).toBe(true);
    const v = validateComponents();
    expect(v({ ...good, components: [{ ...good.components[0], id: "Bad_Id" }] })).toBe(false);
    expect(v({ ...good, components: [{ ...good.components[0], params: [{ id: "x", label: "x", kind: "number" }] }] })).toBe(false);
    expect(v({ ...good, components: [{ ...good.components[0], extra: 1 }] })).toBe(false);
  });

  it("画面の部品を「独自部品として登録」して作った定義 (差し込み口入り) が schema に通る。画面側の itemRef に差し込み口は書けない", () => {
    const panel: LayoutNode = { id: "searchPanel", type: "search-panel", props: { title: "商品検索", columns: 2 }, children: [
      { id: "code", type: "field", itemRef: "productCode" },
      { id: "go", type: "button", itemRef: "searchButton", props: { label: "検索", screenRef: "product-search", variant: "primary" } },
    ] };
    const items = [{ id: "productCode", label: "商品コード" }, { id: "searchButton", label: "検索" }];
    const picked = suggestParams([panel], items).filter((c) => c.kind === "item" || (c.kind === "text" && c.prop === "title") || c.kind === "screen");
    const { def } = buildComponentDef({
      id: "product-search-panel", label: "商品検索パネル", nodes: [panel],
      params: picked.map((c, k) => ({ candidate: c, paramId: `p${k}`, label: c.label })),
    });
    expect(JSON.stringify(def)).toContain("{{p");
    const v = validateComponents();
    expect(v({ version: 1, components: [def] }), JSON.stringify(v.errors)).toBe(true);
    // 画面側 (screen.v3) の itemRef は識別子だけ。差し込み口は定義の中でだけ使える
    const screen = { id: "s", uuid: "11111111-1111-4111-8111-111111111111", name: "画面", kind: "form", path: "/s", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", items: [], layout: { version: 1, nodes: [{ id: "f", type: "field", itemRef: "{{p0}}" }] } };
    expect(validateScreen()(screen)).toBe(false);
  });

  it("画面の schema は参照部品 (type=component / componentRef / args) を受け付ける", () => {
    const screen = {
      id: "s", uuid: "11111111-1111-4111-8111-111111111111", name: "画面", kind: "form", path: "/s",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", items: [],
      layout: { version: 1, nodes: [{ id: "c", type: "component", componentRef: "box", args: { who: "name" } }] },
    };
    expect(validateScreen()(screen)).toBe(true);
    expect(validateScreen()({ ...screen, layout: { version: 1, nodes: [{ id: "c", type: "component", args: { who: 1 } }] } })).toBe(false);
  });
});

describe.each(examples)("サンプル %s の独自部品", (ex) => {
  const dataDir = read(path.join(ROOT, "examples", ex, "harmony.json")).dataDir ?? "harmony";
  const file = path.join(ROOT, "examples", ex, dataDir, "layout-components.json");
  const has = fs.existsSync(file);
  const defs: LayoutComponentDef[] = has ? read(file).components : [];

  it.runIf(has)("定義が schema と validateComponentDefs に通る", () => {
    const v = validateComponents();
    expect(v(read(file)), JSON.stringify(v.errors)).toBe(true);
    expect(validateComponentDefs(defs).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("画面は schema に通り、独自部品を展開したレイアウトにエラー (存在しない項目・独自部品・遷移先) が無い", () => {
    const screensDir = path.join(ROOT, "examples", ex, dataDir, "screens");
    const ids = new Set(fs.readdirSync(screensDir).filter((f) => f.endsWith(".json") && !f.includes(".design.")).map((f) => f.replace(/\.json$/, "")));
    for (const id of ids) {
      const screen = read(path.join(screensDir, `${id}.json`));
      if (!screen.layout) continue;
      const v = validateScreen();
      expect(v(screen), `${ex}/${id}: ${JSON.stringify(v.errors)}`).toBe(true);
      const errors = validateLayoutWithComponents(screen.layout, screen.items ?? [], defs, ids).filter((i) => i.severity === "error");
      expect(errors, `${ex}/${id}`).toEqual([]);
    }
  });
});
