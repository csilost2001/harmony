/**
 * 利用者と役割 (`<データフォルダ>/access.json`)。閲覧 / 編集 / 承認 / 管理の 4 つ。
 * 利用者名はブラウザの自己申告で、本人確認ではない。この設定は、誤操作・誤った承認を防ぐための運用上の区別である
 * (なりすましを防ぐには、接続トークン HARMONY_AUTH_TOKEN とネットワークの制限を使う)。
 * 利用者が 1 人も登録されていなければ、従来どおり制限しない。
 */
import { cleanActor, isRecord, type Parsed } from "./common.js";

export const ROLES = ["viewer", "editor", "approver", "admin"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = { viewer: "閲覧", editor: "編集", approver: "承認", admin: "管理" };
const RANK: Record<Role, number> = { viewer: 0, editor: 1, approver: 2, admin: 3 };

export interface AccessUser { name: string; role: Role }
export interface AccessPolicy {
  /** 確定 (成熟度 committed) には、承認を必須にする */
  requireApprovalForCommitted: boolean;
}
export interface AccessFile { version: 1; users: AccessUser[]; policy: AccessPolicy }

export const emptyAccess = (): AccessFile => ({ version: 1, users: [], policy: { requireApprovalForCommitted: false } });
export const MAX_USERS = 200;

export function parseAccess(raw: unknown): Parsed<AccessFile> {
  const value = emptyAccess();
  const problems: string[] = [];
  if (raw === undefined || raw === null) return { value, problems };
  if (!isRecord(raw)) return { value, problems: ["access.json の形が正しくありません"] };
  if (Array.isArray(raw.users)) {
    const seen = new Set<string>();
    raw.users.slice(0, MAX_USERS).forEach((u, i) => {
      const name = isRecord(u) ? cleanActor(u.name) : "";
      if (!isRecord(u) || !name) { problems.push(`利用者の ${i + 1} 件目: 名前を書いてください`); return; }
      if (!(ROLES as readonly string[]).includes(u.role as string)) { problems.push(`利用者「${name}」: 役割は ${ROLES.join(" / ")} のどれかです`); return; }
      if (seen.has(name.toLowerCase())) { problems.push(`利用者「${name}」が重複しています`); return; }
      seen.add(name.toLowerCase());
      value.users.push({ name, role: u.role as Role });
    });
    if (raw.users.length > MAX_USERS) problems.push(`利用者が多すぎます (${MAX_USERS} 人まで)`);
  } else if (raw.users !== undefined) problems.push("利用者は配列で書いてください");
  if (isRecord(raw.policy)) value.policy.requireApprovalForCommitted = raw.policy.requireApprovalForCommitted === true;
  return { value, problems };
}

/** 利用者の役割。登録がなければ null (制限しない設定のとき、または未登録の名前) */
export function roleOf(access: AccessFile, actor: string): Role | null {
  const n = cleanActor(actor).toLowerCase();
  return access.users.find((u) => u.name.toLowerCase() === n)?.role ?? null;
}
/** 役割の設定が有効か (利用者が 1 人でも登録されている) */
export const accessEnforced = (access: AccessFile): boolean => access.users.length > 0;

/**
 * その操作を許すか。設定が無効なら常に許す。有効で、名前が未登録のときは「閲覧」として扱う (名乗っていない人に、書かせない)。
 * AI (MCP) の操作は、ここを通らない (AI の権限は HARMONY_MCP_MODE / HARMONY_MCP_DENY)。
 */
export function can(access: AccessFile, actor: string, need: Role): boolean {
  if (!accessEnforced(access)) return true;
  const r = roleOf(access, actor) ?? "viewer";
  return RANK[r] >= RANK[need];
}

/** 管理者を 1 人以上残す (自分を外して、誰も管理できなくなるのを防ぐ)。利用者が 0 人 (制限なし) への戻しは許す */
export function hasAdmin(access: AccessFile): boolean {
  return access.users.length === 0 || access.users.some((u) => u.role === "admin");
}
