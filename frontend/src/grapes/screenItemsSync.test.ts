import { describe, it, expect } from "vitest";
import type { Component } from "grapesjs";
import { explicitItemId } from "./screenItemsSync";

function cmp(attrs: Record<string, string>): Component {
  return { getAttributes: () => attrs } as unknown as Component;
}

describe("explicitItemId", () => {
  it("data-item-id を最優先で採用する", () => {
    expect(explicitItemId(cmp({ "data-item-id": "addProductCode", name: "other", id: "ix1" }))).toBe("addProductCode");
  });

  it("data-item-id が UUID の場合は name を採用する", () => {
    expect(explicitItemId(cmp({ "data-item-id": "3f2b8c1e-1d2a-4b3c-8d4e-5f6a7b8c9d0e", name: "quantity" }))).toBe("quantity");
  });

  it("GrapesJS の内部 id だけを持つ要素は項目として扱わない", () => {
    expect(explicitItemId(cmp({ id: "imyus6" }))).toBe("");
  });
});
