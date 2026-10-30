/**
 * AI (MCP) の書き込みの tool (監査ログの「AI が <tool> を実行した」) を、どの設計の変更として数えるか (続編 第 9 弾 #162・#171・#177)。
 * 設計のあゆみ・最終編集者・期間のまとめが、画面からの保存と同じに、AI の変更も数えるための対応表。
 * backend の試験が、書き込みの tool を全部数え上げて、「対応表にある」か「数えない理由がある」のどちらかであることを確かめる (新しい tool を足すと、どちらかに入れるまで試験が落ちる)。
 */
export type AuditDesignKind = "screen" | "table" | "processFlow" | "businessFlow" | "report" | "sequence" | "view" | "viewDefinition" | "pageLayout";

/** tool 名 (designer__ を除く) → 設計の種類。対象の id は、引数から記録される (記録の対象) */
const RULES: ReadonlyArray<[RegExp, AuditDesignKind]> = [
  [/^(add|update|remove)_table$/, "table"],
  [/^(add|update|remove)_screen$|^set_screen_layout$|^save_screen$|^rename_screen_item$|^apply_rename_mapping$/, "screen"],
  [/^(add|update|delete)_process_flow$|^(add|update|remove|nest|move)_step$|^edit_steps$|^add_action$|^set_maturity$|^add_step_note$|^(add|remove)_catalog_entry$/, "processFlow"],
  [/^(save|delete)_business_flow$/, "businessFlow"],
  [/^(save|delete)_report$/, "report"],
  [/^(add|update|remove|save)_page_layout$/, "pageLayout"],
];

/** 設計の種類が、tool 名でなく、記録の備考 (引数の resourceType / entityType) で決まる tool。編集セッションの保存・保存前の版の書き戻し・改名・スキーマ移行・シーケンスなどの保存 / 削除 (引数の kind) */
const BY_DETAIL = /^(editSession__save|restore_version|rename_entity|migrate_schema|save_design|delete_design)$/;

/** 備考の値 (編集セッションの resourceType・設計の entityType) → 設計の種類 */
const DETAIL_KIND: Record<string, AuditDesignKind> = {
  "screen-item": "screen", screen: "screen", table: "table", "process-flow": "processFlow", processFlow: "processFlow", "business-flow": "businessFlow", businessFlow: "businessFlow",
  report: "report", sequence: "sequence", view: "view", "view-definition": "viewDefinition", viewDefinition: "viewDefinition", "page-layout": "pageLayout", pageLayout: "pageLayout",
};

/** tool 名 (designer__ の有無は問わない) と記録の備考から、変更された設計の種類。設計の変更として数えない tool は null */
export function aiToolDesignKind(tool: string, detail?: string): AuditDesignKind | null {
  const name = tool.replace(/^designer__/, "");
  const byName = RULES.find(([re]) => re.test(name));
  if (byName) return byName[1];
  if (BY_DETAIL.test(name)) return DETAIL_KIND[(detail ?? "").trim()] ?? null;
  return null;
}

/** 書き込みの tool のうち、1 件の設計の変更として数えないもの → 数えない理由 (名前は designer__ を除く) */
export const AI_TOOLS_NOT_ATTRIBUTED: Readonly<Record<string, string>> = {
  add_edge: "画面フローの遷移 (設計 1 件の変更ではない)", remove_edge: "画面フローの遷移 (設計 1 件の変更ではない)",
  save_layout_component: "独自部品 (部品の一覧)", delete_layout_component: "独自部品 (部品の一覧)",
  add_marker: "マーカー (AI への指示・質問。設計の内容の変更ではない)", resolve_marker: "マーカー (設計の内容の変更ではない)", remove_marker: "マーカー (設計の内容の変更ではない)",
  add_review_findings: "レビューコメント (設計の内容の変更ではない)",
  replace_references: "複数の設計にまたがる付け替え (変更の記録には、画面からの一括置換と同じく、1 件のまとめとして残る)", undo_replace_references: "複数の設計にまたがる付け替えの取り消し",
  undo_rename: "改名の取り消し (複数のファイルにまたがる)",
  repair_registry: "一覧 (harmony.json) の修復 (設計の内容の変更ではない)", persist_uuids: "uuid の保存 (設計の内容の変更ではない)",
  save_all: "未保存の全タブの保存 (どの設計かを、記録から引けない)",
  record_generation: "生成の記録 (設計の内容の変更ではない)",
  record_scaffold: "開発コンテナの雛形の記録 (設計の内容の変更ではない)",
  add_response_type_extension: "拡張 (設計ではなく、拡張の定義)", update_response_type_extension: "拡張 (設計ではなく、拡張の定義)", delete_response_type_extension: "拡張 (設計ではなく、拡張の定義)",
  add_step_extension: "拡張 (設計ではなく、拡張の定義)", add_field_type_extension: "拡張 (設計ではなく、拡張の定義)", add_trigger_extension: "拡張 (設計ではなく、拡張の定義)", add_db_operation_extension: "拡張 (設計ではなく、拡張の定義)", remove_extension: "拡張 (設計ではなく、拡張の定義)",
  solution_pack: "解決策パックの書き出し (設計は変えない)", solution_unpack: "解決策パックの取り込み (複数の設計にまたがる)",
  report_confusion: "AI が詰まった点の記録 (設計ではなく、改善のためのメモ。git に載らない)",
  workspace_remove: "ワークスペースの登録 (設計ではない)",
  save_conventions: "規約 (設計 1 件ではなく、プロジェクト全体の取り決め)", save_tech_stack: "技術スタック (設計 1 件ではなく、プロジェクトの設定)",
  import_ddl: "取り込み (複数のテーブルをまとめて作る。予行は記録しない)", import_openapi: "取り込み (複数の処理フローをまとめて作る。予行は記録しない)",
  editSession__create: "編集セッションの操作 (保存するまで、設計の原本は変わらない)", editSession__attach_as_view: "編集セッションの操作", editSession__detach: "編集セッションの操作",
  editSession__set_role: "編集セッションの操作", editSession__transfer_edit: "編集セッションの操作", editSession__update: "編集セッションの下書きの更新 (保存 editSession__save で、はじめて原本が変わる)", editSession__discard: "編集セッションの破棄 (原本は変わらない)",
};
