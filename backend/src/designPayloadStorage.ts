import fs from "fs/promises";
import path from "path";
import { assertPathContained } from "./security/idValidator.js";

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
    await fs.writeFile(filePath, html, "utf-8");
    delete target.components;
    target.componentsRef = ref;
  }

  return cloned;
}

export async function deleteDesignComponentCompanions(baseDir: string, baseName: string): Promise<void> {
  await cleanupComponentCompanions(baseDir, baseName);
}
