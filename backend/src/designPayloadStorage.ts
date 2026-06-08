import fs from "fs/promises";
import path from "path";
import { parseDocument } from "htmlparser2";
import { assertPathContained } from "./security/idValidator.js";

interface HtmlNode {
  type: string;
  name?: string;
  attribs?: Record<string, string>;
  children?: HtmlNode[];
  data?: string;
}

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

function assertSafeRelativeRef(ref: string): void {
  if (!ref || path.isAbsolute(ref) || ref.includes("/") || ref.includes("\\") || ref.includes("..")) {
    throw new Error(`Invalid design companion ref: ${ref}`);
  }
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

function componentRefName(baseName: string, index: number): string {
  return index === 0 ? `${baseName}.components.html` : `${baseName}.${index + 1}.components.html`;
}

function isElementNode(node: HtmlNode): boolean {
  return node.type === "tag" || node.type === "script" || node.type === "style";
}

function isMeaningfulNode(node: HtmlNode): boolean {
  return isElementNode(node) || node.type === "comment" || Boolean(node.data?.trim());
}

function escapeAttribute(value: string): string {
  return value.replace(/"/g, "&quot;");
}

function attributeText(attribs: Record<string, string> | undefined): string {
  if (!attribs || Object.keys(attribs).length === 0) return "";
  const parts = Object.entries(attribs).map(([name, value]) => (
    value === "" ? name : `${name}="${escapeAttribute(value)}"`
  ));
  return ` ${parts.join(" ")}`;
}

function hasNestedElement(node: HtmlNode): boolean {
  return (node.children ?? []).some((child) => isElementNode(child) || hasNestedElement(child));
}

function shouldFormatHtmlFragment(nodes: HtmlNode[]): boolean {
  const meaningfulNodes = nodes.filter(isMeaningfulNode);
  const elementNodes = meaningfulNodes.filter(isElementNode);
  if (elementNodes.length === 0) return false;
  if (meaningfulNodes.length > 1) return true;
  return hasNestedElement(elementNodes[0]);
}

function formatHtmlNode(node: HtmlNode, depth: number): string[] {
  const indent = "  ".repeat(depth);

  if (node.type === "comment") {
    return [`${indent}<!--${node.data ?? ""}-->`];
  }

  if (!isElementNode(node)) {
    const text = node.data?.replace(/\s+/g, " ").trim();
    return text ? [`${indent}${text}`] : [];
  }

  const tagName = node.name ?? "";
  const openTag = `<${tagName}${attributeText(node.attribs)}>`;
  if (VOID_ELEMENTS.has(tagName.toLowerCase())) {
    return [`${indent}${openTag}`];
  }

  const childLines = (node.children ?? []).flatMap((child) => formatHtmlNode(child, depth + 1));
  if (childLines.length === 0) {
    return [`${indent}${openTag}</${tagName}>`];
  }

  if (childLines.length === 1 && !isElementNode((node.children ?? []).find(isMeaningfulNode) ?? { type: "text" })) {
    return [`${indent}${openTag}${childLines[0].trim()}</${tagName}>`];
  }

  return [
    `${indent}${openTag}`,
    ...childLines,
    `${indent}</${tagName}>`,
  ];
}

function formatComponentHtml(html: string): string {
  if (html.includes("\n")) return html;
  const doc = parseDocument(html, {
    decodeEntities: false,
    lowerCaseAttributeNames: false,
  }) as unknown as { children: HtmlNode[] };
  const nodes = doc.children ?? [];
  if (!shouldFormatHtmlFragment(nodes)) return html;
  return `${nodes.flatMap((node) => formatHtmlNode(node, 0)).join("\n")}\n`;
}

async function cleanupComponentCompanions(baseDir: string, baseName: string): Promise<void> {
  let files: string[];
  try {
    files = await fs.readdir(baseDir);
  } catch {
    return;
  }
  const exact = `${baseName}.components.html`;
  const prefix = `${baseName}.`;
  for (const file of files) {
    const isComponentCompanion = file === exact || (file.startsWith(prefix) && file.endsWith(".components.html"));
    if (!isComponentCompanion) continue;
    const filePath = path.join(baseDir, file);
    assertPathContained(filePath, baseDir);
    try {
      await fs.unlink(filePath);
    } catch {
      // already gone
    }
  }
}

async function walkInflate(value: unknown, baseDir: string): Promise<void> {
  if (Array.isArray(value)) {
    for (const item of value) await walkInflate(item, baseDir);
    return;
  }
  if (!isRecord(value)) return;

  const ref = value.componentsRef;
  if (typeof ref === "string") {
    assertSafeRelativeRef(ref);
    const filePath = path.join(baseDir, ref);
    assertPathContained(filePath, baseDir);
    const html = await readTextIfExists(filePath);
    if (html !== null) value.components = html;
  }

  for (const child of Object.values(value)) {
    await walkInflate(child, baseDir);
  }
}

function walkCollectComponentStrings(value: unknown, targets: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) walkCollectComponentStrings(item, targets);
    return;
  }
  if (!isRecord(value)) return;

  if (typeof value.components === "string") {
    targets.push(value);
    return;
  }

  for (const child of Object.values(value)) {
    walkCollectComponentStrings(child, targets);
  }
}

export async function inflateDesignComponents(data: unknown, baseDir: string): Promise<unknown> {
  const cloned = cloneJson(data);
  await walkInflate(cloned, baseDir);
  return cloned;
}

export async function deflateDesignComponents(params: {
  data: unknown;
  baseDir: string;
  baseName: string;
}): Promise<unknown> {
  const { data, baseDir, baseName } = params;
  const cloned = cloneJson(data);
  const targets: Record<string, unknown>[] = [];
  walkCollectComponentStrings(cloned, targets);

  await fs.mkdir(baseDir, { recursive: true });
  await cleanupComponentCompanions(baseDir, baseName);
  if (targets.length === 0) return cloned;

  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    const html = target.components;
    if (typeof html !== "string") continue;
    const ref = componentRefName(baseName, i);
    const filePath = path.join(baseDir, ref);
    assertPathContained(filePath, baseDir);
    await fs.writeFile(filePath, formatComponentHtml(html), "utf-8");
    delete target.components;
    target.componentsRef = ref;
  }

  return cloned;
}

export async function deleteDesignComponentCompanions(baseDir: string, baseName: string): Promise<void> {
  await cleanupComponentCompanions(baseDir, baseName);
}
