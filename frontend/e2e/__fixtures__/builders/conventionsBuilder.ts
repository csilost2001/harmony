/**
 * v3 Conventions builder — e2e テスト用 fixture 生成。
 *
 * defaults:
 * - version: "1.0.0" (SemVer required)
 */

import type {
  Conventions,
  SemVer,
  Timestamp,
} from "../../../src/types/v3";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

export interface BuildConventionsOpts {
  version?: string;
  msg?: Conventions["msg"];
  regex?: Conventions["regex"];
  limit?: Conventions["limit"];
  scope?: Conventions["scope"];
  currency?: Conventions["currency"];
  tax?: Conventions["tax"];
  auth?: Conventions["auth"];
  role?: Conventions["role"];
  permission?: Conventions["permission"];
  db?: Conventions["db"];
  numbering?: Conventions["numbering"];
  tx?: Conventions["tx"];
  externalOutcomeDefaults?: Conventions["externalOutcomeDefaults"];
  i18n?: Conventions["i18n"];
}

export function buildConventions(opts: BuildConventionsOpts = {}): Conventions {
  return {
    $schema: "../../schemas/v3/conventions.v3.schema.json",
    version: (opts.version ?? "1.0.0") as unknown as SemVer,
    updatedAt: FIXED_TS,
    msg: opts.msg,
    regex: opts.regex,
    limit: opts.limit,
    scope: opts.scope,
    currency: opts.currency,
    tax: opts.tax,
    auth: opts.auth,
    role: opts.role,
    permission: opts.permission,
    db: opts.db,
    numbering: opts.numbering,
    tx: opts.tx,
    externalOutcomeDefaults: opts.externalOutcomeDefaults,
    i18n: opts.i18n,
  };
}
