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
