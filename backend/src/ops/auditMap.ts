/** 画面からの RPC のうち、監査ログに残すもの (成功したときだけ)。何をしたかを、人が読める文にする */
const ID_KEYS = ["tableId", "processFlowId", "screenId", "flowId", "reportId", "sequenceId", "viewId", "viewDefinitionId", "pageLayoutId", "id", "name"];

const LABELS: Record<string, string> = {
  saveTable: "テーブルを保存した", deleteTable: "テーブルを削除した", saveProcessFlow: "処理フローを保存した", deleteProcessFlow: "処理フローを削除した",
  saveScreenEntity: "画面を保存した", deleteScreen: "画面を削除した", saveBusinessFlow: "業務フローを保存した", deleteBusinessFlow: "業務フローを削除した",
  saveReport: "帳票を保存した", deleteReport: "帳票を削除した", saveSequence: "シーケンスを保存した", deleteSequence: "シーケンスを削除した",
  saveView: "DB ビューを保存した", deleteView: "DB ビューを削除した", saveViewDefinition: "ビュー定義を保存した", deleteViewDefinition: "ビュー定義を削除した",
  savePageLayout: "ページレイアウトを保存した", deletePageLayout: "ページレイアウトを削除した", saveGenericDefinition: "汎用定義を保存した", deleteGenericDefinition: "汎用定義を削除した",
  saveLayoutComponent: "独自部品を保存した", deleteLayoutComponent: "独自部品を削除した", saveConventions: "規約を保存した", saveProject: "プロジェクトの設定・一覧を保存した",
  renameEntityId: "設計の id を改名した", renameScreenItem: "画面項目を改名した", undoEntityRename: "改名を取り消した",
  "designReplace.apply": "設計全体を置換した", "designReplace.undo": "設計全体の置換を取り消した", "editSession.save": "編集内容を保存した",
  "workspace.persistUuids": "uuid を保存した", "workspace.repairRegistry": "一覧を修復した",
  "designCheck.suppress": "要確認を抑制した", "designCheck.unsuppress": "要確認の抑制を外した", "designCheck.saveRules": "独自の検査ルールを保存した",
};

/** `sessionTarget`: 編集セッションの id から「種類 id」を引く (editSession.save の対象) */
export function describeRpc(method: string, params: unknown, result?: unknown, sessionTarget?: string): { action: string; target?: string; detail?: string } | null {
  const action = LABELS[method];
  if (!action) return null;
  const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
  let target: string | undefined;
  if (method === "editSession.save") {
    // 衝突の確認だけ (checkOnly) と、衝突で保存されなかったものは、残さない
    if (p.stage === "checkOnly" || (result && typeof result === "object" && (result as { ok?: unknown }).ok === false)) return null;
    target = sessionTarget;
  }
  else if (method === "renameEntityId") target = [p.entityType ?? p.kind, p.from ?? p.oldId, "→", p.to ?? p.newId].filter((x) => typeof x === "string").join(" ") || undefined;
  else if (method === "saveGenericDefinition" || method === "deleteGenericDefinition") target = [p.kind, p.name].filter((x) => typeof x === "string").join("/") || undefined;
  else for (const k of ID_KEYS) if (typeof p[k] === "string") { target = p[k] as string; break; }
  return { action, ...(target ? { target } : {}) };
}

/**
 * 新しく作る tool (add_table など) の結果の文から、作られた設計の id を引く (「…を追加しました（ID: table-ab12cd34）」)。
 * 引数には id が無く、そのままでは、名前が対象として残るため。見つからなければ undefined。
 */
export function createdIdFromResultText(text: string): string | undefined {
  return /ID[:：]\s*([A-Za-z0-9][A-Za-z0-9._-]{0,99})/.exec(text)?.[1];
}
