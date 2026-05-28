/**
 * pageLayoutCompositionPreview — composition preview の CSS 合成 (#1406) を検証する。
 *
 * 検証対象:
 *   1. extractGrapesCss — GrapesJS design の styles 配列を CSS string に直列化する
 *   2. composePreviewHtml — region 差し替え (既存挙動の回帰)
 *   3. buildCompositionPreviewSrcDoc — link href + project CSS を iframe srcDoc に合成する
 *      + `</style>` 注入の無害化 (S-003 / CWE-79 の延長)
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

  it("project CSS 内の </style> 注入を無害化する (S-003 / HTML injection 防止)", () => {
    const malicious = ".a{}</style><script>alert(1)</script><style>.b{}";
    const doc = buildCompositionPreviewSrcDoc("<div></div>", [], [malicious]);
    // 生の </style> でブロックが閉じられていないこと (= script タグが style 外に漏れない)
    expect(doc).not.toContain("</style><script>");
    expect(doc).toContain("<\\/style");
  });

  it("link href の \" や < はエスケープ除去される", () => {
    const doc = buildCompositionPreviewSrcDoc("<div></div>", ['/a.css" onload="x']);
    expect(doc).not.toContain('onload="x"');
    expect(doc).toContain('href="/a.css onload=x"');
  });
});
