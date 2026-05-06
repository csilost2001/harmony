import { describe, it, expect } from "vitest";
import { ensureFormFieldIdentity, getItemIdPrefix } from "./dataItemId";
import type { Component, Editor as GEditor } from "grapesjs";

function makeCmp(tag: string, attrs: Record<string, string> = {}): Component {
  const current = { ...attrs };
  return {
    get: (key: string) => (key === "tagName" ? tag : undefined),
    getAttributes: () => ({ ...current }),
    addAttributes: (patch: Record<string, string>) => {
      Object.assign(current, patch);
    },
    _attrs: current,
  } as unknown as Component;
}

/** editor モック: wrapper 配下に任意コンポーネントを持てる */
function makeEditor(existingComponents: Component[] = []): GEditor {
  const rootChildren = { forEach: (fn: (c: Component) => void) => existingComponents.forEach(fn) };
  const wrapper = {
    get: () => undefined,
    getAttributes: () => ({}),
    addAttributes: () => {},
    components: () => rootChildren,
  } as unknown as Component;
  return { getWrapper: () => wrapper } as unknown as GEditor;
}

// ---------------------------------------------------------------------------
// getItemIdPrefix
// ---------------------------------------------------------------------------
describe("getItemIdPrefix", () => {
  it("input[text] → textInput", () => {
    expect(getItemIdPrefix(makeCmp("input", { type: "text" }))).toBe("textInput");
  });
  it("input (type 省略) → textInput", () => {
    expect(getItemIdPrefix(makeCmp("input"))).toBe("textInput");
  });
  it("input[password] → passwordInput", () => {
    expect(getItemIdPrefix(makeCmp("input", { type: "password" }))).toBe("passwordInput");
  });
  it("input[number] → numberInput", () => {
    expect(getItemIdPrefix(makeCmp("input", { type: "number" }))).toBe("numberInput");
  });
  it("input[range] → numberInput", () => {
    expect(getItemIdPrefix(makeCmp("input", { type: "range" }))).toBe("numberInput");
  });
  it("input[date] → dateInput", () => {
    expect(getItemIdPrefix(makeCmp("input", { type: "date" }))).toBe("dateInput");
  });
  it("input[datetime-local] → datetimeInput", () => {
    expect(getItemIdPrefix(makeCmp("input", { type: "datetime-local" }))).toBe("datetimeInput");
  });
  it("input[time] → timeInput", () => {
    expect(getItemIdPrefix(makeCmp("input", { type: "time" }))).toBe("timeInput");
  });
  it("input[email] → emailInput", () => {
    expect(getItemIdPrefix(makeCmp("input", { type: "email" }))).toBe("emailInput");
  });
  it("input[tel] → telInput", () => {
    expect(getItemIdPrefix(makeCmp("input", { type: "tel" }))).toBe("telInput");
  });
  it("input[url] → urlInput", () => {
    expect(getItemIdPrefix(makeCmp("input", { type: "url" }))).toBe("urlInput");
  });
  it("input[file] → fileInput", () => {
    expect(getItemIdPrefix(makeCmp("input", { type: "file" }))).toBe("fileInput");
  });
  it("input[checkbox] → checkbox", () => {
    expect(getItemIdPrefix(makeCmp("input", { type: "checkbox" }))).toBe("checkbox");
  });
  it("input[radio] → radio", () => {
    expect(getItemIdPrefix(makeCmp("input", { type: "radio" }))).toBe("radio");
  });
  it("textarea → textarea", () => {
    expect(getItemIdPrefix(makeCmp("textarea"))).toBe("textarea");
  });
  it("select → select", () => {
    expect(getItemIdPrefix(makeCmp("select"))).toBe("select");
  });
  it("button → button", () => {
    expect(getItemIdPrefix(makeCmp("button"))).toBe("button");
  });
});

// ---------------------------------------------------------------------------
// ensureFormFieldIdentity — editor なし (フォールバック)
// ---------------------------------------------------------------------------
describe("ensureFormFieldIdentity (editor なし / フォールバック)", () => {
  it("input drop 時に name / id / data-item-id が同時付与される", () => {
    const cmp = makeCmp("input", { type: "text" });
    const changed = ensureFormFieldIdentity(cmp);
    expect(changed).toBe(true);
    const attrs = cmp.getAttributes();
    expect(attrs["data-item-id"]).toMatch(/^[0-9a-f]{8}-/);
    expect(attrs.name).toMatch(/^field_[0-9a-f]{8}$/);
    expect(attrs.id).toBe(attrs.name);
  });

  it("name の先頭 8 文字は data-item-id の先頭セグメントと一致する", () => {
    const cmp = makeCmp("input", { type: "text" });
    ensureFormFieldIdentity(cmp);
    const attrs = cmp.getAttributes();
    const shortId = attrs["data-item-id"].split("-")[0];
    expect(attrs.name).toBe(`field_${shortId}`);
  });

  it("既に name がある要素は name を上書きしない", () => {
    const cmp = makeCmp("input", { type: "text", name: "my_field" });
    ensureFormFieldIdentity(cmp);
    expect(cmp.getAttributes().name).toBe("my_field");
  });

  it("既に data-item-id がある要素は data-item-id を上書きしない", () => {
    const cmp = makeCmp("input", { type: "text", "data-item-id": "existing-uuid" });
    ensureFormFieldIdentity(cmp);
    expect(cmp.getAttributes()["data-item-id"]).toBe("existing-uuid");
  });

  it("既にすべての属性がある要素は false を返す", () => {
    const cmp = makeCmp("input", {
      type: "text",
      "data-item-id": "uuid-1",
      name: "field_1",
      id: "field_1",
    });
    const changed = ensureFormFieldIdentity(cmp);
    expect(changed).toBe(false);
  });

  it("data-item-id 有り・name/id 無しの場合は name/id だけが既存 data-item-id から派生して付与される", () => {
    const cmp = makeCmp("input", { type: "text", "data-item-id": "abcd1234-5678-4000-8000-aaaaaaaaaaaa" });
    const changed = ensureFormFieldIdentity(cmp);
    expect(changed).toBe(true);
    const attrs = cmp.getAttributes();
    expect(attrs["data-item-id"]).toBe("abcd1234-5678-4000-8000-aaaaaaaaaaaa");
    expect(attrs.name).toBe("field_abcd1234");
    expect(attrs.id).toBe("field_abcd1234");
  });

  it("button type は付与しない", () => {
    expect(ensureFormFieldIdentity(makeCmp("input", { type: "button" }))).toBe(false);
  });
  it("submit type は付与しない", () => {
    expect(ensureFormFieldIdentity(makeCmp("input", { type: "submit" }))).toBe(false);
  });
  it("hidden type は付与しない", () => {
    expect(ensureFormFieldIdentity(makeCmp("input", { type: "hidden" }))).toBe(false);
  });
  it("reset type は付与しない", () => {
    expect(ensureFormFieldIdentity(makeCmp("input", { type: "reset" }))).toBe(false);
  });
  it("image type は付与しない", () => {
    expect(ensureFormFieldIdentity(makeCmp("input", { type: "image" }))).toBe(false);
  });
  it("select に付与される", () => {
    const cmp = makeCmp("select");
    expect(ensureFormFieldIdentity(cmp)).toBe(true);
    expect(cmp.getAttributes().name).toMatch(/^field_/);
  });
  it("textarea に付与される", () => {
    const cmp = makeCmp("textarea");
    expect(ensureFormFieldIdentity(cmp)).toBe(true);
    expect(cmp.getAttributes()["data-item-id"]).toBeDefined();
  });
  it("div など非 form field は対象外", () => {
    expect(ensureFormFieldIdentity(makeCmp("div"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ensureFormFieldIdentity — editor あり (種別+連番)
// ---------------------------------------------------------------------------
describe("ensureFormFieldIdentity (editor あり / 種別+連番)", () => {
  it("空画面に input[text] を追加すると textInput1 になる", () => {
    const editor = makeEditor([]);
    const cmp = makeCmp("input", { type: "text" });
    ensureFormFieldIdentity(cmp, editor);
    expect(cmp.getAttributes().name).toBe("textInput1");
    expect(cmp.getAttributes().id).toBe("textInput1");
  });

  it("textInput1 が存在する画面では textInput2 になる", () => {
    const existing = makeCmp("input", { type: "text", name: "textInput1", "data-item-id": "x" });
    const editor = makeEditor([existing]);
    const cmp = makeCmp("input", { type: "text" });
    ensureFormFieldIdentity(cmp, editor);
    expect(cmp.getAttributes().name).toBe("textInput2");
  });

  it("textInput1 と textInput3 が混在する画面では textInput4 になる", () => {
    const e1 = makeCmp("input", { type: "text", name: "textInput1", "data-item-id": "a" });
    const e3 = makeCmp("input", { type: "text", name: "textInput3", "data-item-id": "b" });
    const editor = makeEditor([e1, e3]);
    const cmp = makeCmp("input", { type: "text" });
    ensureFormFieldIdentity(cmp, editor);
    expect(cmp.getAttributes().name).toBe("textInput4");
  });

  it("種別が異なる prefix は独立してカウントされる (textInput と select)", () => {
    const existing = makeCmp("input", { type: "text", name: "textInput1", "data-item-id": "a" });
    const editor = makeEditor([existing]);
    const sel = makeCmp("select");
    ensureFormFieldIdentity(sel, editor);
    expect(sel.getAttributes().name).toBe("select1");
  });

  it("field_xxx が混在しても連番が破綻しない", () => {
    const old1 = makeCmp("input", { type: "text", name: "field_abc12345", "data-item-id": "a" });
    const new1 = makeCmp("input", { type: "text", name: "textInput1", "data-item-id": "b" });
    const editor = makeEditor([old1, new1]);
    const cmp = makeCmp("input", { type: "text" });
    ensureFormFieldIdentity(cmp, editor);
    expect(cmp.getAttributes().name).toBe("textInput2");
  });

  it("button 要素に button1 が付与される", () => {
    const editor = makeEditor([]);
    const cmp = makeCmp("button");
    ensureFormFieldIdentity(cmp, editor);
    expect(cmp.getAttributes().name).toBe("button1");
  });

  it("button1 が存在する画面では button2 になる", () => {
    const existing = makeCmp("button", { name: "button1", "data-item-id": "x" });
    const editor = makeEditor([existing]);
    const cmp = makeCmp("button");
    ensureFormFieldIdentity(cmp, editor);
    expect(cmp.getAttributes().name).toBe("button2");
  });

  it("checkbox に checkbox1 が付与される", () => {
    const editor = makeEditor([]);
    const cmp = makeCmp("input", { type: "checkbox" });
    ensureFormFieldIdentity(cmp, editor);
    expect(cmp.getAttributes().name).toBe("checkbox1");
  });

  it("radio に radio1 が付与される", () => {
    const editor = makeEditor([]);
    const cmp = makeCmp("input", { type: "radio" });
    ensureFormFieldIdentity(cmp, editor);
    expect(cmp.getAttributes().name).toBe("radio1");
  });

  it("既に name がある要素は editor があっても name を上書きしない", () => {
    const editor = makeEditor([]);
    const cmp = makeCmp("input", { type: "text", name: "myField" });
    ensureFormFieldIdentity(cmp, editor);
    expect(cmp.getAttributes().name).toBe("myField");
  });
});
