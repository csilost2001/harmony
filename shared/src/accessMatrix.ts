/**
 * 権限マトリクスの導出 (役割 × 画面 / 処理)。
 *
 * 規約カタログの役割 (role) と権限 (permission)、画面の `permissions`、処理の `requiredPermissions` から、
 * 「どの役割がどの画面・処理を使えるか」を決定的に導く。新しいスキーマは要らない。
 *
 * 仕様: docs/spec/design-document.md「権限の章」
 */

export interface AccessRole {
  name?: string;
  description?: string;
  permissions: readonly string[];
  inherits?: readonly string[];
}

export interface AccessPermission {
  resource?: string;
  action?: string;
  scope?: string;
  description?: string;
}

export interface AccessSubject {
  id: string;
  name: string;
  /** 必要な権限 (すべて必要)。`@conv.permission.` の接頭辞は付けても付けなくてもよい */
  permissions: readonly string[];
}

export interface AccessIssue {
  severity: "warning" | "info";
  target: string;
  message: string;
}

export interface AccessMatrixRow {
  id: string;
  name: string;
  /** 正規化した必要権限 */
  permissions: string[];
  /** 権限が 1 つも要らない (誰でも使える) */
  open: boolean;
  /** 使える役割の ID */
  roles: string[];
}

export interface AccessMatrix {
  roleIds: string[];
  /** 役割ごとの有効な権限 (継承込み) */
  effective: Record<string, string[]>;
  screens: AccessMatrixRow[];
  flows: AccessMatrixRow[];
  issues: AccessIssue[];
}

const PREFIX = "@conv.permission.";

/** `@conv.permission.<key>` / `<key>` をキーにそろえる */
export function normalizePermissionKey(k: string): string {
  return k.startsWith(PREFIX) ? k.slice(PREFIX.length) : k;
}

/** 役割ごとの有効な権限 (継承込み)。未定義の継承元と循環は無視し、問題として返す */
export function effectivePermissions(roles: Record<string, AccessRole>): { effective: Record<string, string[]>; issues: AccessIssue[] } {
  const issues: AccessIssue[] = [];
  const effective: Record<string, string[]> = {};
  const resolve = (id: string, stack: string[]): Set<string> => {
    const role = roles[id];
    const acc = new Set<string>((role?.permissions ?? []).map(normalizePermissionKey));
    for (const parent of role?.inherits ?? []) {
      if (!roles[parent]) { issues.push({ severity: "warning", target: `役割 ${id}`, message: `継承元の役割「${parent}」が定義されていません` }); continue; }
      if (stack.includes(parent) || parent === id) { issues.push({ severity: "warning", target: `役割 ${id}`, message: `役割の継承が循環しています (${[...stack, id, parent].join(" → ")})` }); continue; }
      for (const p of resolve(parent, [...stack, id])) acc.add(p);
    }
    return acc;
  };
  for (const id of Object.keys(roles)) effective[id] = [...resolve(id, [])].sort();
  // 循環の警告は同じ内容が複数の起点から出るので重複を除く
  const seen = new Set<string>();
  return { effective, issues: issues.filter((i) => { const k = `${i.target}|${i.message}`; if (seen.has(k)) return false; seen.add(k); return true; }) };
}

/**
 * 役割 × 画面 / 処理のマトリクスと、定義の不整合を導く。
 * 画面・処理が要求する権限はすべて満たす必要がある (AND)。要求が無ければ誰でも使える。
 */
export function deriveAccessMatrix(input: {
  roles: Record<string, AccessRole>;
  permissions: Record<string, AccessPermission>;
  screens: readonly AccessSubject[];
  flows: readonly AccessSubject[];
}): AccessMatrix {
  const { effective, issues } = effectivePermissions(input.roles);
  const roleIds = Object.keys(input.roles);
  const defined = new Set(Object.keys(input.permissions));
  const granted = new Set(Object.values(effective).flat());
  const used = new Set<string>();

  const rows = (subjects: readonly AccessSubject[], kind: string): AccessMatrixRow[] => subjects.map((s) => {
    const perms = [...new Set(s.permissions.map(normalizePermissionKey))];
    for (const p of perms) {
      used.add(p);
      if (!defined.has(p)) issues.push({ severity: "warning", target: `${kind} ${s.name}`, message: `必要な権限「${p}」が規約に定義されていません` });
      else if (!granted.has(p)) issues.push({ severity: "warning", target: `${kind} ${s.name}`, message: `必要な権限「${p}」はどの役割にも付与されていないため、誰も使えません` });
    }
    return { id: s.id, name: s.name, permissions: perms, open: perms.length === 0, roles: roleIds.filter((r) => perms.every((p) => effective[r].includes(p))) };
  });
  const screens = rows(input.screens, "画面");
  const flows = rows(input.flows, "処理");

  for (const [rid, role] of Object.entries(input.roles)) {
    for (const p of role.permissions.map(normalizePermissionKey)) {
      if (!defined.has(p)) issues.push({ severity: "warning", target: `役割 ${role.name ?? rid}`, message: `付与する権限「${p}」が規約に定義されていません` });
    }
  }
  for (const p of defined) {
    if (!used.has(p)) issues.push({ severity: "info", target: `権限 ${p}`, message: "どの画面・処理でも必要とされていません" });
  }
  return { roleIds, effective, screens, flows, issues };
}
