/**
 * pageLayoutCompositionPreview — composition preview の CSS 合成 (#1406) を検証する。
 *
 * 検証対象:
 *   1. extractGrapesCss — GrapesJS design の styles 配列を CSS string に直列化する
 *   2. composePreviewHtml — region 差し替え (既存挙動の回帰)
 *   3. buildCompositionPreviewSrcDoc — link href + project CSS を iframe srcDoc に合成する
 *      + href の HTML 属性エスケープ (Must-fix 1)
 *      + `<style>` break-out の中和 (S-003 / CWE-79 の延長、Must-fix 2 / Should-fix 5)
 *
 * 注意 (Should-fix 5): `_neutralizeStyleClose` は CSS 全般の sanitize ではなく
 * `<style>` 要素の break-out (`</style>` 注入) 中和に限定。body HTML 側の XSS 対策は
 * composePreviewHtml() 内の DOMPurify が担う。
 */

import { describe, it, expect } from "vitest";
import {
  extractGrapesCss,
  extractGrapesHtml,
  composePreviewHtml,
  buildCompositionPreviewSrcDoc,
} from "./pageLayoutCompositionPreview";

describe("extractGrapesCss (#1406)", () => {
  it("styles が空 / 欠落の design では空文字を返す", () => {
    expect(extractGrapesCss(null)).toBe("");
    expect(extractGrapesCss({})).toBe("");
    expect(extractGrapesCss({ styles: [] })).toBe("");
  });

  it("class セレクタ + style を CSS 規則に直列化する", () => {
    const design = {
      styles: [
        { selectors: [{ name: "card", type: 1 }], style: { color: "red", "font-size": "14px" } },
      ],
    };
    const css = extractGrapesCss(design);
    expect(css).toContain(".card{");
    expect(css).toContain("color:red;");
    expect(css).toContain("font-size:14px;");
  });

  it("id セレクタ (type=2) は # prefix で直列化する", () => {
    const design = { styles: [{ selectors: [{ name: "main", type: 2 }], style: { margin: "0" } }] };
    expect(extractGrapesCss(design)).toContain("#main{margin:0;}");
  });

  it("文字列セレクタ (prefix なし) は class 扱いにする", () => {
    const design = { styles: [{ selectors: ["btn"], style: { padding: "4px" } }] };
    expect(extractGrapesCss(design)).toContain(".btn{padding:4px;}");
  });

  it("state (hover 等) を擬似クラスとして付与する", () => {
    const design = {
      styles: [{ selectors: [{ name: "link", type: 1 }], state: "hover", style: { color: "blue" } }],
    };
    expect(extractGrapesCss(design)).toContain(".link:hover{color:blue;}");
  });

  it("media at-rule を @media でラップする", () => {
    const design = {
      styles: [
        {
          selectors: [{ name: "col", type: 1 }],
          atRuleType: "media",
          mediaText: "(max-width: 768px)",
          style: { width: "100%" },
        },
      ],
    };
    const css = extractGrapesCss(design);
    expect(css).toContain("@media (max-width: 768px){.col{width:100%;}}");
  });

  it("空 style の規則はスキップする", () => {
    const design = { styles: [{ selectors: [{ name: "empty", type: 1 }], style: {} }] };
    expect(extractGrapesCss(design)).toBe("");
  });

  // Should-fix 4 (#1406 Codex review): singleAtRule (@font-face / @keyframes 等) は
  // selector を持たず宣言ブロックのみを at-rule で包む。GrapesJS の永続化形式で
  // atRuleType + singleAtRule:true として保持される。
  it("@font-face (singleAtRule) は selector なしで宣言ブロックを包む", () => {
    const design = {
      styles: [
        {
          atRuleType: "font-face",
          singleAtRule: true,
          style: { "font-family": "MyFont", src: "url(/f.woff2)" },
        },
      ],
    };
    const css = extractGrapesCss(design);
    expect(css).toContain("@font-face{");
    expect(css).toContain("font-family:MyFont;");
    expect(css).toContain("src:url(/f.woff2);");
    // selector wrapper (.xxx{ や {{ ) が付いていないこと
    expect(css).not.toContain("{{");
  });

  it("@keyframes (singleAtRule) を atRuleType で包む", () => {
    const design = {
      styles: [
        {
          atRuleType: "keyframes my-anim",
          singleAtRule: true,
          style: { from: "x", to: "y" },
        },
      ],
    };
    const css = extractGrapesCss(design);
    expect(css).toContain("@keyframes my-anim{");
    expect(css).toContain("from:x;");
    expect(css).toContain("to:y;");
  });
});

describe("composePreviewHtml — region 差し替え (回帰)", () => {
  it("main region は screen 本文に置換される", () => {
    const html = '<div data-region-name="main"></div>';
    const out = composePreviewHtml(html, {}, new Map(), "<p>本文</p>");
    expect(out).toContain("本文");
    expect(out).toContain('data-pl-content-slot="true"');
  });

  it("gadget region は assignments の gadget HTML に置換される", () => {
    const html = '<div data-region-name="header"></div>';
    const out = composePreviewHtml(html, { header: "gadget-1" }, new Map([["gadget-1", "<nav>menu</nav>"]]), "");
    expect(out).toContain("menu");
  });

  it("extractGrapesHtml と組み合わせて design から HTML を取り出せる", () => {
    const design = { pages: [{ frames: [{ component: { components: "<section>x</section>" } }] }] };
    expect(extractGrapesHtml(design)).toBe("<section>x</section>");
  });
});

describe("buildCompositionPreviewSrcDoc (#1406)", () => {
  it("style href を <link> として head に注入する", () => {
    const doc = buildCompositionPreviewSrcDoc("<div>body</div>", [
      "https://cdn.example/bootstrap.css",
      "/assets/theme-bootstrap.css",
    ]);
    expect(doc).toContain('<link href="https://cdn.example/bootstrap.css" rel="stylesheet">');
    expect(doc).toContain('<link href="/assets/theme-bootstrap.css" rel="stylesheet">');
    expect(doc).toContain("<div>body</div>");
  });

  it("project CSS ブロックを <style> として注入する", () => {
    const doc = buildCompositionPreviewSrcDoc(
      "<div></div>",
      ["/a.css"],
      [".card{color:red;}", "#main{margin:0;}"],
    );
    expect(doc).toContain("<style>.card{color:red;}</style>");
    expect(doc).toContain("<style>#main{margin:0;}</style>");
  });

  it("空文字 / 空白のみの CSS ブロックは注入しない", () => {
    const doc = buildCompositionPreviewSrcDoc("<div></div>", ["/a.css"], ["", "   ", ".x{color:blue;}"]);
    const styleCount = (doc.match(/<style>/g) ?? []).length;
    // body reset の 1 つ + project CSS 1 つ = 2 (空ブロックは載らない)
    expect(styleCount).toBe(2);
    expect(doc).toContain(".x{color:blue;}");
  });

  // Must-fix 2 (#1406 Codex review): projectCssBlocks 由来の <style> ブロックだけを抽出し、
  // その中身に「生の </style> で閉じられていない」「script が style 外に漏れない」ことを assert する。
  // doc 全体に対する toContain は偽陽性 (body reset の <style> 等を拾う) になりうるため使わない。
  //
  // projectCssBlocks 由来の <style> は body reset (`<style>body{...}</style>`) の **後** に
  // 連結されるため、最後の <style>...</style> ブロックを抽出して検証する。
  const extractLastStyleBlock = (doc: string): string => {
    const matches = [...doc.matchAll(/<style>([\s\S]*?)<\/style>/g)];
    expect(matches.length).toBeGreaterThan(0);
    return matches[matches.length - 1][1];
  };

  it.each([
    [".a{}</style><script>alert(1)</script><style>.b{}", "小文字 </style>"],
    [".a{}</STYLE><script>alert(1)</script>", "大文字 </STYLE>"],
    ["x</style><script>alert(1)</script>", "script 混入"],
    [".a{}</style ><script>alert(1)</script>", "末尾空白 </style >"],
  ])("project CSS の %s 注入を無害化し style ブロックから漏れない (S-003)", (malicious) => {
    const doc = buildCompositionPreviewSrcDoc("<div></div>", [], [malicious]);
    const block = extractLastStyleBlock(doc);
    // style ブロック内に生の </style (= 閉じタグ) が残っていないこと
    expect(block).not.toMatch(/<\/style/i);
    // 中和された形 (<\/style) になっていること
    expect(block).toContain("<\\/style");
    // script タグが style ブロック内に閉じ込められている (= style 外に漏れていない)
    expect(block).toContain("<script>");
  });

  // Must-fix 1 (#1406 Codex review): href は HTML 属性エスケープする (除去ではなく実体参照化)。
  it('link href は HTML 属性エスケープされる ("/\'/<>/& を実体参照化)', () => {
    const doc = buildCompositionPreviewSrcDoc("<div></div>", ['/a.css" onload="x']);
    // onload を実行できる生の属性境界 (") は残らない
    expect(doc).not.toContain('onload="x"');
    // " は &quot; にエスケープされる
    expect(doc).toContain('href="/a.css&quot; onload=&quot;x"');
  });

  it("href の & は二重エスケープされない (& を最初に処理)", () => {
    const doc = buildCompositionPreviewSrcDoc("<div></div>", ["/a.css?x=1&y=2"]);
    expect(doc).toContain('href="/a.css?x=1&amp;y=2"');
    // &amp; が &amp;amp; に二重エスケープされていないこと
    expect(doc).not.toContain("&amp;amp;");
  });

  it("href の < > ' もエスケープされる", () => {
    const doc = buildCompositionPreviewSrcDoc("<div></div>", ["/a<b>'c.css"]);
    expect(doc).toContain('href="/a&lt;b&gt;&#39;c.css"');
  });
});
