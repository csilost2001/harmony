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

const WHITESPACE_SENSITIVE_ELEMENTS = new Set(["pre", "script", "style", "textarea"]);

const BLOCK_ELEMENTS = new Set([
  "address", "article", "aside", "blockquote", "body", "caption", "colgroup", "dd", "details",
  "dialog", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1",
  "h2", "h3", "h4", "h5", "h6", "head", "header", "hgroup", "hr", "html", "legend", "li",
  "main", "menu", "nav", "ol", "optgroup", "option", "p", "pre", "section", "summary", "table",
  "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
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

function hasWhitespaceSensitiveElement(node: HtmlNode): boolean {
  if (isElementNode(node) && WHITESPACE_SENSITIVE_ELEMENTS.has((node.name ?? "").toLowerCase())) {
    return true;
  }
  return (node.children ?? []).some(hasWhitespaceSensitiveElement);
}

function hasMixedTextAndElementChildren(node: HtmlNode): boolean {
  const children = node.children ?? [];
  const hasText = children.some((child) => child.type === "text" && (child.data ?? "").length > 0);
  const hasElement = children.some(isElementNode);
  return (hasText && hasElement) || children.some(hasMixedTextAndElementChildren);
}

function hasMixedTopLevelTextAndElement(nodes: HtmlNode[]): boolean {
  const hasText = nodes.some((node) => node.type === "text" && (node.data ?? "").length > 0);
  const hasElement = nodes.some(isElementNode);
  return hasText && hasElement;
}

function isKnownBlockElementNode(node: HtmlNode): boolean {
  return isElementNode(node) && BLOCK_ELEMENTS.has((node.name ?? "").toLowerCase());
}

function containsOnlyKnownBlockElements(nodes: HtmlNode[]): boolean {
  return nodes.length > 0 && nodes.every(isKnownBlockElementNode);
}

function shouldFormatHtmlFragment(nodes: HtmlNode[]): boolean {
  const meaningfulNodes = nodes.filter(isMeaningfulNode);
  const elementNodes = meaningfulNodes.filter(isElementNode);
  if (elementNodes.length === 0) return false;
  if (hasMixedTopLevelTextAndElement(meaningfulNodes)) return false;
  if (!containsOnlyKnownBlockElements(meaningfulNodes)) return false;
  if (elementNodes.some((node) => hasWhitespaceSensitiveElement(node) || hasMixedTextAndElementChildren(node))) {
    return false;
  }
  if (meaningfulNodes.length > 1) return true;
  return hasNestedElement(elementNodes[0]);
}

function compactHtmlNode(node: HtmlNode): string {
  if (node.type === "comment") return `<!--${node.data ?? ""}-->`;
  if (!isElementNode(node)) return node.data ?? "";

  const tagName = node.name ?? "";
  const openTag = `<${tagName}${attributeText(node.attribs)}>`;
  if (VOID_ELEMENTS.has(tagName.toLowerCase())) return openTag;
  return `${openTag}${(node.children ?? []).map(compactHtmlNode).join("")}</${tagName}>`;
}

function formatHtmlNode(node: HtmlNode, depth: number): string[] {
  const indent = "  ".repeat(depth);

  if (node.type === "comment") {
    return [`${indent}<!--${node.data ?? ""}-->`];
  }

  if (!isElementNode(node)) {
    if (!node.data || !node.data.trim()) return [];
    return [`${indent}${node.data}`];
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

  const meaningfulChildren = (node.children ?? []).filter(isMeaningfulNode);
  if (meaningfulChildren.length === 1 && meaningfulChildren[0].type === "text") {
    return [`${indent}${openTag}${meaningfulChildren[0].data ?? ""}</${tagName}>`];
  }
  if (!containsOnlyKnownBlockElements(meaningfulChildren)) {
    return [`${indent}${openTag}${meaningfulChildren.map(compactHtmlNode).join("")}</${tagName}>`];
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
