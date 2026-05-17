/**
 * RolePanel — `@conv.role.*` カタログ編集 panel (#1145 Phase-5)
 *
 * 業務 integrity issue (UNKNOWN_CONV_ROLE_PERMISSION / ROLE_INHERITS_CYCLE 等) も
 * 行毎に折込表示する。
 */
import { Fragment, useMemo, useState } from "react";
import { DeleteBtn, EntriesWrapper, NewKeyRow } from "../SharedRowParts";
import type { RoleEntry } from "../../../../types/v3";
import type { ConventionIssue } from "../../../../schemas/conventionsValidator";

export interface RolePanelProps {
  role: Record<string, RoleEntry>;
  permissionKeys: string[];
  issues: ConventionIssue[];
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<RoleEntry>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}

export function RolePanel({
  role, permissionKeys, issues, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: RolePanelProps) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(role);
  const roleKeys = Object.keys(role);

  // role.<key> から始まる issue を key 別に集約
  const issuesByKey = useMemo(() => {
    const map = new Map<string, ConventionIssue[]>();
    for (const iss of issues) {
      const m = /^role\.([^.[]+)/.exec(iss.path);
      if (!m) continue;
      const k = m[1];
      const arr = map.get(k) ?? [];
      arr.push(iss);
      map.set(k, arr);
    }
    return map;
  }, [issues]);

  const permissionListId = "conventions-permission-keys";
  const roleListId = "conventions-role-keys";

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <datalist id={permissionListId}>
        {permissionKeys.map((k) => <option key={k} value={k} />)}
      </datalist>
      <datalist id={roleListId}>
        {roleKeys.map((k) => <option key={k} value={k} />)}
      </datalist>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "12em" }} />
          <col style={{ width: "10em" }} />
          <col style={{ width: "14em" }} />
          <col />
          <col style={{ width: "16em" }} />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.role.xxx)</th>
            <th>name</th>
            <th>description</th>
            <th>permissions (カンマ区切り)</th>
            <th>inherits (カンマ区切り)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, entry]) => {
            const rowIssues = issuesByKey.get(key) ?? [];
            const hasPermIssue = rowIssues.some((i) =>
              i.code === "UNKNOWN_CONV_ROLE_PERMISSION" && i.path.startsWith(`role.${key}.permissions`),
            );
            const hasInheritsIssue = rowIssues.some((i) =>
              (i.code === "UNKNOWN_CONV_ROLE_INHERITS" || i.code === "ROLE_INHERITS_CYCLE") &&
              i.path.startsWith(`role.${key}.inherits`),
            );
            return (
              <Fragment key={key}>
                <tr>
                  <td><code className="conventions-key-badge">{key}</code></td>
                  <td>
                    <input
                      className="form-control form-control-sm"
                      value={entry.name ?? ""}
                      onChange={(e) => onUpdate(key, { name: e.target.value || undefined })}
                      onBlur={onCommit}
                      placeholder="顧客"
                    />
                  </td>
                  <td>
                    <input
                      className="form-control form-control-sm"
                      value={entry.description ?? ""}
                      onChange={(e) => onUpdate(key, { description: e.target.value || undefined })}
                      onBlur={onCommit}
                    />
                  </td>
                  <td>
                    <input
                      className={`form-control form-control-sm ${hasPermIssue ? "is-invalid" : ""}`}
                      list={permissionListId}
                      value={(entry.permissions ?? []).join(", ")}
                      onChange={(e) => {
                        const perms = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                        onUpdate(key, { permissions: perms });
                      }}
                      onBlur={onCommit}
                      placeholder="order.create, order.read"
                    />
                  </td>
                  <td>
                    <input
                      className={`form-control form-control-sm ${hasInheritsIssue ? "is-invalid" : ""}`}
                      list={roleListId}
                      value={(entry.inherits ?? []).join(", ")}
                      onChange={(e) => {
                        const inh = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                        onUpdate(key, { inherits: inh.length > 0 ? inh : undefined });
                      }}
                      onBlur={onCommit}
                      placeholder="customer"
                    />
                  </td>
                  <td className="text-center"><DeleteBtn onClick={() => onRemove(key)} isReadonly={isReadonly} /></td>
                </tr>
                {rowIssues.length > 0 && (
                  <tr className="conventions-row-issues">
                    <td />
                    <td colSpan={5}>
                      <ul className="conventions-issue-list">
                        {rowIssues.map((iss, i) => (
                          <li key={i} className="conventions-issue">
                            <i className="bi bi-exclamation-triangle-fill" />
                            <span className="conventions-issue-message">{iss.message}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <NewKeyRow
        placeholder="新規 key (例: customer)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !role[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(role, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}
