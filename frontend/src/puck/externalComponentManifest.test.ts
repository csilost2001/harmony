/**
 * externalComponentManifest.test.ts — manifest validator のテスト (#1409 P-1)。
 */
import { describe, it, expect } from "vitest";
import { validateExternalComponentManifest } from "./externalComponentManifest";

describe("validateExternalComponentManifest", () => {
  it("最小限の valid manifest を受理する", () => {
    const input = {
      schemaVersion: "1",
      components: [
        { id: "foo", label: "Foo", module: "./dist/foo.mjs", version: "1.0.0" },
      ],
    };
    const result = validateExternalComponentManifest(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.components).toHaveLength(1);
      expect(result.manifest.components[0].id).toBe("foo");
    }
  });

  it("engine / props / slots / export を含む valid manifest を受理する", () => {
    const input = {
      schemaVersion: "1",
      components: [
        {
          id: "bar",
          label: "Bar",
          module: "./dist/bar.mjs",
          export: "Bar",
          version: "2.1.0",
          engine: { react: "19", puck: "0.20" },
          props: [
            { name: "title", type: "string", label: "見出し", default: "x" },
            {
              name: "mode",
              type: "enum",
              enum: [
                { label: "A", value: "a" },
                { label: "B", value: "b" },
              ],
            },
          ],
          slots: [{ name: "content", label: "本文" }],
        },
      ],
    };
    const result = validateExternalComponentManifest(input);
    expect(result.ok).toBe(true);
  });

  it("schemaVersion が不正なら拒否する", () => {
    const result = validateExternalComponentManifest({
      schemaVersion: "2",
      components: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("schemaVersion"))).toBe(true);
    }
  });

  it("components が配列でないなら拒否する", () => {
    const result = validateExternalComponentManifest({
      schemaVersion: "1",
      components: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("components"))).toBe(true);
    }
  });

  it("必須 field (version) 欠落を検出する", () => {
    const result = validateExternalComponentManifest({
      schemaVersion: "1",
      components: [{ id: "foo", label: "Foo", module: "./dist/foo.mjs" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("version"))).toBe(true);
    }
  });

  it("型不正 (module が数値) を検出する", () => {
    const result = validateExternalComponentManifest({
      schemaVersion: "1",
      components: [{ id: "foo", label: "Foo", module: 123, version: "1.0" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("module"))).toBe(true);
    }
  });

  it("id 重複を検出する", () => {
    const result = validateExternalComponentManifest({
      schemaVersion: "1",
      components: [
        { id: "dup", label: "A", module: "./a.mjs", version: "1.0" },
        { id: "dup", label: "B", module: "./b.mjs", version: "1.0" },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("重複"))).toBe(true);
    }
  });

  it("enum 型で enum 配列が無いと拒否する", () => {
    const result = validateExternalComponentManifest({
      schemaVersion: "1",
      components: [
        {
          id: "foo",
          label: "Foo",
          module: "./foo.mjs",
          version: "1.0",
          props: [{ name: "mode", type: "enum" }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("enum"))).toBe(true);
    }
  });

  it("オブジェクトでない入力を拒否する", () => {
    expect(validateExternalComponentManifest(null).ok).toBe(false);
    expect(validateExternalComponentManifest("x").ok).toBe(false);
    expect(validateExternalComponentManifest([]).ok).toBe(false);
  });

  // --- slot 検証 (#1411 P-3) ---

  it("slot あり (prop と非衝突) の正常 manifest を受理する", () => {
    const result = validateExternalComponentManifest({
      schemaVersion: "1",
      components: [
        {
          id: "foo",
          label: "Foo",
          module: "./foo.mjs",
          version: "1.0",
          props: [{ name: "title", type: "string" }],
          slots: [
            { name: "header", label: "ヘッダ" },
            { name: "content", label: "本文" },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("slot 名重複を検出する", () => {
    const result = validateExternalComponentManifest({
      schemaVersion: "1",
      components: [
        {
          id: "foo",
          label: "Foo",
          module: "./foo.mjs",
          version: "1.0",
          slots: [
            { name: "content", label: "A" },
            { name: "content", label: "B" },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (e) => e.includes("content") && e.includes("重複"),
        ),
      ).toBe(true);
    }
  });

  it("slot 名と prop 名の衝突を検出する", () => {
    const result = validateExternalComponentManifest({
      schemaVersion: "1",
      components: [
        {
          id: "foo",
          label: "Foo",
          module: "./foo.mjs",
          version: "1.0",
          props: [{ name: "content", type: "string" }],
          slots: [{ name: "content", label: "本文" }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (e) => e.includes("content") && e.includes("衝突"),
        ),
      ).toBe(true);
    }
  });

  it("slot 名 unique 検証は per-entry scope: 別 entry 間で同名 slot は許容する", () => {
    // slot 名の一意性は entry ごとに閉じている。別 component が同名 slot を
    // 持っていても衝突ではない (各 component の props 名前空間が独立しているため)。
    const result = validateExternalComponentManifest({
      schemaVersion: "1",
      components: [
        {
          id: "panel-a",
          label: "Panel A",
          module: "./a.mjs",
          version: "1.0",
          slots: [{ name: "content", label: "本文" }],
        },
        {
          id: "panel-b",
          label: "Panel B",
          module: "./b.mjs",
          version: "1.0",
          slots: [{ name: "content", label: "本文" }],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.components).toHaveLength(2);
      expect(result.manifest.components[0].slots?.[0].name).toBe("content");
      expect(result.manifest.components[1].slots?.[0].name).toBe("content");
    }
  });
});
