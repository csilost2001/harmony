import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildDesignDocument, deriveAccessMatrix, effectivePermissions, normalizePermissionKey, type DesignDocInput } from "@harmony/shared";

const roles = {
  staff: { name: "店員", permissions: ["a:view"] },
  manager: { name: "店長", inherits: ["staff"], permissions: ["a:edit"] },
};
const permissions = { "a:view": { resource: "A", action: "参照" }, "a:edit": { resource: "A", action: "更新" } };

describe("権限マトリクスの導出", () => {
  it("接頭辞付きのキーもキーだけも同じに扱う", () => {
    expect(normalizePermissionKey("@conv.permission.a:view")).toBe("a:view");
    expect(normalizePermissionKey("a:view")).toBe("a:view");
  });

  it("役割の継承を含めた有効な権限を求める", () => {
    expect(effectivePermissions(roles).effective).toEqual({ staff: ["a:view"], manager: ["a:edit", "a:view"] });
  });

  it("継承元が未定義・循環のときは無視して問題にする", () => {
    const r = effectivePermissions({ x: { permissions: [], inherits: ["nope", "y"] }, y: { permissions: ["p"], inherits: ["x"] } });
    expect(r.issues.map((i) => i.message).join("\n")).toMatch(/「nope」が定義されていません/);
    expect(r.issues.map((i) => i.message).join("\n")).toMatch(/循環/);
    expect(r.effective.x).toEqual(["p"]);
  });

  it("必要な権限をすべて持つ役割だけが使える。指定が無ければ誰でも使える", () => {
    const m = deriveAccessMatrix({
      roles, permissions,
      screens: [
        { id: "s1", name: "参照画面", permissions: ["@conv.permission.a:view"] },
        { id: "s2", name: "更新画面", permissions: ["a:edit"] },
        { id: "s3", name: "両方", permissions: ["a:view", "a:edit"] },
        { id: "s4", name: "指定なし", permissions: [] },
      ],
      flows: [],
    });
    expect(m.screens.map((r) => [r.id, r.roles, r.open])).toEqual([
      ["s1", ["staff", "manager"], false], ["s2", ["manager"], false], ["s3", ["manager"], false], ["s4", ["staff", "manager"], true],
    ]);
    expect(m.issues).toEqual([]);
  });

  it("不整合を検出する: 未定義の権限 / 誰にも付与されていない権限 / どこでも使われない権限", () => {
    const m = deriveAccessMatrix({
      roles: { r: { name: "役", permissions: ["a:view", "ghost"] } },
      permissions: { ...permissions, "a:edit": permissions["a:edit"] },
      screens: [{ id: "s", name: "画面", permissions: ["a:edit", "unknown"] }],
      flows: [],
    });
    const msgs = m.issues.map((i) => `${i.severity}:${i.target}:${i.message}`);
    expect(msgs.some((x) => x.includes("必要な権限「unknown」が規約に定義されていません"))).toBe(true);
    expect(msgs.some((x) => x.includes("必要な権限「a:edit」はどの役割にも付与されていないため、誰も使えません"))).toBe(true);
    expect(msgs.some((x) => x.includes("付与する権限「ghost」が規約に定義されていません"))).toBe(true);
    expect(msgs.some((x) => x.startsWith("info:権限 a:view"))).toBe(true);
  });
});

const root = path.resolve(__dirname, "../../../../examples/retail");
const readDir = (d: string) => fs.readdirSync(path.join(root, "harmony", d)).filter((n) => n.endsWith(".json")).map((n) => JSON.parse(fs.readFileSync(path.join(root, "harmony", d, n), "utf-8")));
const catalog = JSON.parse(fs.readFileSync(path.join(root, "harmony", "conventions", "catalog.json"), "utf-8"));
const harmony = JSON.parse(fs.readFileSync(path.join(root, "harmony.json"), "utf-8"));
const base: DesignDocInput = {
  project: { id: "retail", name: "retail" }, screens: readDir("screens"), flows: readDir("process-flows"), tables: readDir("tables"),
  transitions: harmony.entities.screenTransitions, messages: catalog.msg, roles: catalog.role, permissions: catalog.permission, version: "t", generatedAt: "2026-10-09T00:00:00.000Z",
};

describe("設計書の「権限」の章 (retail 実データ)", () => {
  const doc = buildDesignDocument(base);
  it("役割・権限・画面 × 役割・処理 × 役割を出し、継承した権限を反映する", () => {
    expect(doc.toc.map((t) => t.id)).toContain("access");
    const html = doc.html.slice(doc.html.indexOf('id="access"'));
    expect(html).toContain("店員");
    expect(html).toContain("画面 × 役割");
    // 配送指示は店長 (shipment:dispatch) 以上。店員には付かない
    const row = html.match(/<tr><th><a href="#[^"]*">配送指示<\/a><\/th>.*?<\/tr>/s)?.[0] ?? "";
    expect(row.match(/hd-ok/g)?.length).toBe(2);
  });
  it("定義が無く、権限の指定も無いときは章を出さない", () => {
    const d = buildDesignDocument({ ...base, roles: {}, permissions: {}, screens: base.screens.map((s) => ({ ...s, permissions: [] })), flows: base.flows.map((f) => ({ ...f, actions: f.actions.map((a) => ({ ...a, requiredPermissions: [] })) })) });
    expect(d.toc.map((t) => t.id)).not.toContain("access");
  });
  it("retail の権限定義に不整合は無い", () => {
    expect(doc.issues.filter((i) => /権限|役割/.test(i.section + i.message) && i.severity === "warning")).toEqual([]);
  });
});
