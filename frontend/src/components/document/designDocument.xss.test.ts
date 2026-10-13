/**
 * 書き出す設計書 (HTML) の XSS 回帰テスト。
 * 設計データの「すべての文字列」を、タグ・属性の外へ出る文字を含む値に置き換えて書き出し、HTML の中に生のタグ・属性の突き抜けが無いことを確かめる。
 * 項目を足したときに esc() の付け忘れがあれば、ここで見つかる (設計書は HTML 保存・印刷・配布されるため、閲覧側で実行されると被害が大きい)。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildDesignDocument, layoutToHtml, renderStandaloneDesignDoc, type DesignDocInput } from "@harmony/shared";

const root = path.resolve(__dirname, "../../../../examples/retail");
const readDir = (d: string, f = (n: string) => n.endsWith(".json")) => {
  const dir = path.join(root, "harmony", d);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f).map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf-8"))) : [];
};
const harmony = JSON.parse(fs.readFileSync(path.join(root, "harmony.json"), "utf-8"));

const PAYLOADS = [
  `<img src=x onerror=alert(1)>`,
  `"><script>alert(2)</script>`,
  `' onfocus='alert(3)' x='`,
  `</td></tr></table><iframe src=javascript:alert(4)>`,
  `<svg onload=alert(5)>`,
];

/** すべての文字列の値 (オブジェクトのキーは除く) を、悪意のある値に置き換えたコピー */
function taint<T>(value: T, counter = { n: 0 }): T {
  if (typeof value === "string") return `${PAYLOADS[counter.n++ % PAYLOADS.length]}#${counter.n}` as unknown as T;
  if (Array.isArray(value)) return value.map((v) => taint(v, counter)) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, taint(v, counter)])) as T;
  }
  return value;
}

const base: DesignDocInput = {
  project: { id: "retail", name: harmony.meta.name },
  screens: readDir("screens", (n) => n.endsWith(".json") && !n.includes(".design.")),
  flows: readDir("process-flows"),
  tables: readDir("tables"),
  transitions: harmony.entities.screenTransitions,
  messages: JSON.parse(fs.readFileSync(path.join(root, "harmony", "conventions", "catalog.json"), "utf-8")).msg,
  businessFlows: readDir("business-flows"),
  reports: readDir("reports"),
  layoutComponents: fs.existsSync(path.join(root, "harmony", "layout-components.json"))
    ? (JSON.parse(fs.readFileSync(path.join(root, "harmony", "layout-components.json"), "utf-8")).components ?? [])
    : [],
  extraIssues: [{ severity: "warning", section: "テーブル x", message: "スキーマ: 値が不正", ref: { kind: "table", id: "x" } }],
  version: "test",
  generatedAt: "2026-10-08T00:00:00.000Z",
};

/** 生のまま出力されてはいけないもの (エスケープされていれば `&lt;` になる) */
const FORBIDDEN = [/<img\s+src=x/i, /<script>alert/i, /<iframe\s+src=javascript/i, /<svg\s+onload/i, /"><script/i];

/** 生のまま出ている箇所を、前後の文脈つきで返す (失敗したとき、どの項目の esc が抜けているかが分かる) */
function leaks(html: string): string[] {
  const out: string[] = [];
  for (const re of FORBIDDEN) {
    const g = new RegExp(re.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = g.exec(html)) && out.length < 8) out.push(`${re}: …${html.slice(Math.max(0, m.index - 160), m.index + 80)}…`);
  }
  return out;
}

describe("設計書 HTML の XSS (すべての文字列を悪意のある値にして書き出す)", () => {
  for (const [label, render] of [
    ["本文", (i: DesignDocInput) => buildDesignDocument(i).html],
    ["単体 HTML", (i: DesignDocInput) => renderStandaloneDesignDoc(i)],
  ] as const) {
    it(`${label}: 生のタグ・属性の突き抜けが出力に無い`, () => {
      const tainted = taint(base);
      const html = render(tainted);
      expect(html.length).toBeGreaterThan(1000);
      // 業務フロー・帳票・独自部品・外から足した要確認も、入力に含まれている (書き出しの対象が空でない)
      expect(tainted.businessFlows?.length ?? 0).toBeGreaterThan(0);
      expect(tainted.reports?.length ?? 0).toBeGreaterThan(0);
      expect(leaks(html)).toEqual([]);
      // 悪意のある値は、エスケープされた形では出ている (出力から落ちているのではない)
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    });
  }

  it("画面項目・処理フローの工程・テーブルのカラムなど、深い入れ子の値も同様", () => {
    const html = buildDesignDocument(taint({ ...base, flows: base.flows.slice(0, 5), screens: base.screens.slice(0, 5), tables: base.tables.slice(0, 5) })).html;
    expect(leaks(html)).toEqual([]);
  });

  it("画面レイアウト: すべての種類の部品に、すべての props (数のはずの level / columns / span も) を悪意のある値で与えても、タグ・属性が突き抜けない", () => {
    const P = (i: number) => PAYLOADS[i % PAYLOADS.length];
    const props = Object.fromEntries(["text", "title", "label", "tone", "variant", "align", "alt", "level", "columns", "span"].map((k, i) => [k, P(i)]));
    const TYPES = ["heading", "text", "field", "table", "button", "link", "message-area", "image", "divider", "html", "form", "search-panel", "section", "columns", "column", "tabs", "tab", "button-bar", "component"];
    const node = (type: string, n: number, children: unknown[] = []) => ({ id: `n${n}`, type, itemRef: P(n), componentRef: P(n + 1), props, children });
    const leaves = TYPES.map((t, i) => node(t, i));
    // 入れ子の中でも描かれるよう、容器の中にも全種類を置く
    const nodes = [...leaves, ...["form", "search-panel", "section", "columns", "column", "tabs", "tab", "button-bar"].map((t, i) => node(t, 100 + i, leaves))];
    const items = [{ id: P(0), label: P(1), type: "string", direction: "in" as const }];
    const html = layoutToHtml({ version: 1, nodes } as never, items as never, []);
    expect(html.length).toBeGreaterThan(500);
    expect(leaks(html)).toEqual([]);
    // 数のはずの値は、数として出る (文字列は混ざらない)
    expect(html).toMatch(/lv-h2\b/);
    expect(html).toMatch(/lv-cols-1\b/);
    expect(html).toMatch(/flex:6 1 0/);
    expect(html).not.toMatch(/lv-cols-[^\d"\s]/);
  });
});
