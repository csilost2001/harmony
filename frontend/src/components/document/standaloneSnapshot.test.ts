import { describe, it, expect } from "vitest";
import { renderStandaloneDesignDoc, type DesignDocInput } from "@harmony/shared";

const input = {
  project: { id: "p", name: "P" }, version: "1.0", generatedAt: "2026-10-17T09:30:00.000Z",
  screens: [], flows: [],
  tables: [{ id: "orders", name: "注文", physicalName: "orders", columns: [{ physicalName: "id", name: "ID", dataType: "BIGINT" }] }, { id: "items", name: "明細", physicalName: "items", columns: [{ physicalName: "qty", name: "数量", dataType: "INTEGER" }] }],
} as unknown as DesignDocInput;

describe("単体 HTML の読み取り専用スナップショット (続編 第 9 弾 #170)", () => {
  const html = renderStandaloneDesignDoc(input);
  it("検索欄・写しである旨・生成日時・印刷で隠す指定がある", () => {
    expect(html).toContain('id="hd-q"');
    expect(html).toContain("読み取り専用の写しです (生成: 2026-10-17 09:30)");
    expect(html).toContain(".hd-snapshot-note");
    expect(html.match(/<script>/g)).toHaveLength(1); // 検索の 1 つだけ
  });
  it("検索すると、一致しない章・節を隠し、目次のリンクも隠す。空にすると戻る", () => {
    document.open(); document.write(html); document.close();
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
    new Function(script)();
    const q = document.getElementById("hd-q") as HTMLInputElement;
    const secs = [...document.querySelectorAll<HTMLElement>("main .hd-section")];
    expect(secs.length).toBeGreaterThan(1);
    q.value = "数量"; q.dispatchEvent(new Event("input"));
    const visible = secs.filter((s) => !s.hidden);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(secs.length);
    expect(visible.every((s) => (s.textContent ?? "").includes("数量"))).toBe(true);
    expect(document.getElementById("hd-q-count")!.textContent).toContain(`${visible.length} 件`);
    q.value = ""; q.dispatchEvent(new Event("input"));
    expect(secs.every((s) => !s.hidden)).toBe(true);
    expect(document.getElementById("hd-q-count")!.textContent).toBe("");
  });
});
