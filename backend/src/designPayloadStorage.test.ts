import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deflateDesignComponents, inflateDesignComponents } from "./designPayloadStorage.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harmony-design-payload-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("design payload component companion storage", () => {
  it("formats complex single-line HTML fragments before writing componentsRef companions", async () => {
    const data = {
      pages: [{
        frames: [{
          component: {
            type: "wrapper",
            components: "<div class=\"container\"><section><h1>Title</h1><div class=\"row\"><label for=\"name\">Name</label><input id=\"name\" class=\"form-control\"></div></section></div>",
          },
        }],
      }],
    };

    const stored = await deflateDesignComponents({
      data,
      baseDir: tmpDir,
      baseName: "complex-screen",
    }) as any;

    expect(stored.pages[0].frames[0].component).toMatchObject({
      type: "wrapper",
      componentsRef: "complex-screen.components.html",
    });
    expect(stored.pages[0].frames[0].component).not.toHaveProperty("components");

    await expect(fs.readFile(path.join(tmpDir, "complex-screen.components.html"), "utf-8")).resolves.toBe(
      `<div class="container">
  <section>
    <h1>Title</h1>
    <div class="row"><label for="name">Name</label><input id="name" class="form-control"></div>
  </section>
</div>
`,
    );
  });

  it("keeps simple single-element text fragments on one line", async () => {
    await deflateDesignComponents({
      data: {
        pages: [{ frames: [{ component: { components: "<span>Total</span>" } }] }],
      },
      baseDir: tmpDir,
      baseName: "simple-screen",
    });

    await expect(fs.readFile(path.join(tmpDir, "simple-screen.components.html"), "utf-8")).resolves.toBe("<span>Total</span>");
  });

  it("does not format whitespace-sensitive HTML content", async () => {
    const html = "<div><pre>a  b  c</pre><span>Hello</span></div>";

    await deflateDesignComponents({
      data: {
        pages: [{ frames: [{ component: { components: html } }] }],
      },
      baseDir: tmpDir,
      baseName: "pre-screen",
    });

    await expect(fs.readFile(path.join(tmpDir, "pre-screen.components.html"), "utf-8")).resolves.toBe(html);
  });

  it("does not format mixed text and element content", async () => {
    const html = "<p>Hello <strong>customer</strong>, welcome back.</p>";

    await deflateDesignComponents({
      data: {
        pages: [{ frames: [{ component: { components: html } }] }],
      },
      baseDir: tmpDir,
      baseName: "mixed-screen",
    });

    await expect(fs.readFile(path.join(tmpDir, "mixed-screen.components.html"), "utf-8")).resolves.toBe(html);
  });

  it("does not format top-level mixed text and element fragments", async () => {
    const html = "<span>Hello</span>, <span>world</span>";

    await deflateDesignComponents({
      data: {
        pages: [{ frames: [{ component: { components: html } }] }],
      },
      baseDir: tmpDir,
      baseName: "top-level-mixed-screen",
    });

    await expect(fs.readFile(path.join(tmpDir, "top-level-mixed-screen.components.html"), "utf-8")).resolves.toBe(html);
  });

  it("does not format top-level adjacent inline element fragments", async () => {
    const html = "<span>Hello</span><span>world</span>";

    await deflateDesignComponents({
      data: {
        pages: [{ frames: [{ component: { components: html } }] }],
      },
      baseDir: tmpDir,
      baseName: "inline-siblings-screen",
    });

    await expect(fs.readFile(path.join(tmpDir, "inline-siblings-screen.components.html"), "utf-8")).resolves.toBe(html);
  });

  it("keeps nested adjacent inline elements on the same line while formatting their parent", async () => {
    await deflateDesignComponents({
      data: {
        pages: [{ frames: [{ component: { components: "<div><p><span>Hello</span><span>world</span></p><section><h2>Next</h2></section></div>" } }] }],
      },
      baseDir: tmpDir,
      baseName: "nested-inline-siblings-screen",
    });

    await expect(fs.readFile(path.join(tmpDir, "nested-inline-siblings-screen.components.html"), "utf-8")).resolves.toBe(
      `<div>
  <p><span>Hello</span><span>world</span></p>
  <section>
    <h2>Next</h2>
  </section>
</div>
`,
    );
  });

  it("does not format top-level adjacent inline SVG fragments", async () => {
    const html = "<svg viewBox=\"0 0 10 10\"><path d=\"M0 0h10v10H0z\"></path></svg><span>Label</span>";

    await deflateDesignComponents({
      data: {
        pages: [{ frames: [{ component: { components: html } }] }],
      },
      baseDir: tmpDir,
      baseName: "inline-svg-screen",
    });

    await expect(fs.readFile(path.join(tmpDir, "inline-svg-screen.components.html"), "utf-8")).resolves.toBe(html);
  });

  it("keeps nested adjacent inline SVG elements on the same line", async () => {
    await deflateDesignComponents({
      data: {
        pages: [{ frames: [{ component: { components: "<div><p><svg viewBox=\"0 0 10 10\"><path d=\"M0 0h10v10H0z\"></path></svg><span>Label</span></p><section><h2>Next</h2></section></div>" } }] }],
      },
      baseDir: tmpDir,
      baseName: "nested-inline-svg-screen",
    });

    await expect(fs.readFile(path.join(tmpDir, "nested-inline-svg-screen.components.html"), "utf-8")).resolves.toBe(
      `<div>
  <p><svg viewBox="0 0 10 10"><path d="M0 0h10v10H0z"></path></svg><span>Label</span></p>
  <section>
    <h2>Next</h2>
  </section>
</div>
`,
    );
  });

  it("does not format top-level adjacent inline replaced element fragments", async () => {
    const html = "<canvas width=\"10\" height=\"10\"></canvas><span>Label</span>";

    await deflateDesignComponents({
      data: {
        pages: [{ frames: [{ component: { components: html } }] }],
      },
      baseDir: tmpDir,
      baseName: "inline-canvas-screen",
    });

    await expect(fs.readFile(path.join(tmpDir, "inline-canvas-screen.components.html"), "utf-8")).resolves.toBe(html);
  });

  it("does not format top-level adjacent embedded media fragments", async () => {
    const html = "<audio controls></audio><span>Label</span>";

    await deflateDesignComponents({
      data: {
        pages: [{ frames: [{ component: { components: html } }] }],
      },
      baseDir: tmpDir,
      baseName: "inline-audio-screen",
    });

    await expect(fs.readFile(path.join(tmpDir, "inline-audio-screen.components.html"), "utf-8")).resolves.toBe(html);
  });

  it("does not format top-level inline fragments separated by comments", async () => {
    const html = "<span>A</span><!--c--><span>B</span>";

    await deflateDesignComponents({
      data: {
        pages: [{ frames: [{ component: { components: html } }] }],
      },
      baseDir: tmpDir,
      baseName: "inline-comment-screen",
    });

    await expect(fs.readFile(path.join(tmpDir, "inline-comment-screen.components.html"), "utf-8")).resolves.toBe(html);
  });

  it("keeps nested inline fragments separated by comments on the same line", async () => {
    await deflateDesignComponents({
      data: {
        pages: [{ frames: [{ component: { components: "<div><p><span>A</span><!--c--><span>B</span></p><section><h2>Next</h2></section></div>" } }] }],
      },
      baseDir: tmpDir,
      baseName: "nested-inline-comment-screen",
    });

    await expect(fs.readFile(path.join(tmpDir, "nested-inline-comment-screen.components.html"), "utf-8")).resolves.toBe(
      `<div>
  <p><span>A</span><!--c--><span>B</span></p>
  <section>
    <h2>Next</h2>
  </section>
</div>
`,
    );
  });

  it("does not format top-level adjacent custom element fragments", async () => {
    const html = "<my-icon></my-icon><span>Label</span>";

    await deflateDesignComponents({
      data: {
        pages: [{ frames: [{ component: { components: html } }] }],
      },
      baseDir: tmpDir,
      baseName: "custom-element-screen",
    });

    await expect(fs.readFile(path.join(tmpDir, "custom-element-screen.components.html"), "utf-8")).resolves.toBe(html);
  });

  it("does not format top-level adjacent MathML fragments", async () => {
    const html = "<math><mi>x</mi></math><span>Label</span>";

    await deflateDesignComponents({
      data: {
        pages: [{ frames: [{ component: { components: html } }] }],
      },
      baseDir: tmpDir,
      baseName: "mathml-screen",
    });

    await expect(fs.readFile(path.join(tmpDir, "mathml-screen.components.html"), "utf-8")).resolves.toBe(html);
  });

  it("keeps nested adjacent inline replaced elements on the same line", async () => {
    await deflateDesignComponents({
      data: {
        pages: [{ frames: [{ component: { components: "<div><p><canvas width=\"10\" height=\"10\"></canvas><span>Label</span></p><section><h2>Next</h2></section></div>" } }] }],
      },
      baseDir: tmpDir,
      baseName: "nested-inline-canvas-screen",
    });

    await expect(fs.readFile(path.join(tmpDir, "nested-inline-canvas-screen.components.html"), "utf-8")).resolves.toBe(
      `<div>
  <p><canvas width="10" height="10"></canvas><span>Label</span></p>
  <section>
    <h2>Next</h2>
  </section>
</div>
`,
    );
  });

  it("inflates formatted companion HTML without changing the componentsRef round-trip", async () => {
    const stored = await deflateDesignComponents({
      data: {
        pages: [{ frames: [{ component: { components: "<main><h1>Dashboard</h1><p>Ready</p></main>" } }] }],
      },
      baseDir: tmpDir,
      baseName: "round-trip",
    }) as any;

    const inflated = await inflateDesignComponents(stored, tmpDir) as any;

    expect(inflated.pages[0].frames[0].component.componentsRef).toBe("round-trip.components.html");
    expect(inflated.pages[0].frames[0].component.components).toBe(
      `<main>
  <h1>Dashboard</h1>
  <p>Ready</p>
</main>
`,
    );
  });
});
