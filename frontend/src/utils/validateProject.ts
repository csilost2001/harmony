/**
 * validateProject.ts — project.v3.schema.json に対する AJV バリデーション (#835)
 *
 * persistFlowProject の save 直前に呼び出し、schema 違反の silent strip を防止する。
 * AJV は devDependencies 既存 (frontend/package.json)。
 *
 * JSON import は resolveJsonModule: true + Vite の JSON plugin で解決される。
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { Project } from "../types/v3/project";
import commonSchema from "../../../schemas/v3/common.v3.schema.json";
import projectSchema from "../../../schemas/v3/project.v3.schema.json";

let _validateFn: ReturnType<InstanceType<typeof Ajv2020>["compile"]> | null = null;

function getValidateFn(): ReturnType<InstanceType<typeof Ajv2020>["compile"]> {
  if (_validateFn) return _validateFn;
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  // common schema を先に登録して $ref 解決できるようにする
  ajv.addSchema(commonSchema as object);
  _validateFn = ajv.compile(projectSchema as object);
  return _validateFn;
}

export interface ProjectValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateProject(project: unknown): ProjectValidationResult {
  const fn = getValidateFn();
  const valid = fn(project) as boolean;
  if (valid) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: (fn.errors ?? []).map(
      (e) => `${e.instancePath || "/"} ${e.message ?? "?"}`,
    ),
  };
}

export function assertValidProject(project: unknown): asserts project is Project {
  const r = validateProject(project);
  if (!r.valid) {
    throw new Error(
      `[validateProject] schema validation failed:\n  ${r.errors.join("\n  ")}`,
    );
  }
}
