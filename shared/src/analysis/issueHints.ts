/**
 * 要確認の指摘に添える「どう直すか」(機械的な案内)。designer__check_design の応答の `hint`。
 * 指摘の文言の型から決める (指摘の元の検査は、文言を変えるとここが外れる — 試験 designMutation.test.ts が、主な指摘に hint が付くことを見張る)。
 * 案内だけで、設計は書き換えない。AI は案内に従って直し、もう一度 check_design で確かめる。
 */
export interface HintableIssue { severity?: string; section?: string; message: string }

const RULES: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [/テーブル「([^」]+)」がありません \(tableId\)/, (m) => `designer__list_tables で正しいテーブルの id を確かめ、update_step の patch に { "tableId": "<id>" } を入れて直す。テーブル「${m[1]}」を作るつもりなら add_table か import_ddl`],
  [/呼び出す画面「([^」]+)」がありません/, () => "designer__list_screens で画面の id を確かめ、update_process_flow で meta.screenId を直す (呼び出す画面がないなら meta.screenId を消す)"],
  [/遷移先の画面「([^」]+)」がありません/, () => "designer__list_screens で画面の id を確かめ、update_step の patch で targetScreenId を直す"],
  [/結びつき先のテーブル「([^」]+)」がありません/, () => "designer__list_tables で正しいテーブルの id を確かめ、画面項目の binding.ref.tableId を直す (update_screen / save_screen)"],
  [/結びつき先のカラム「([^」]+)」が、テーブル/, () => "designer__get_table でカラムの id・physicalName を確かめ、画面項目の binding.ref.columnId を直す"],
  [/外部キーの参照先のテーブル「([^」]+)」がありません/, () => "designer__list_tables で正しいテーブルの id を確かめ、update_table で constraints の referencedTableId を直す。参照先をまだ作らないなら、その制約に noConstraint: true"],
  [/外部キーの参照先のカラム「([^」]+)」が/, () => "designer__get_table で参照先のカラムの id を確かめ、update_table で referencedColumnIds を直す"],
  [/規約の[^「]+「(@conv\.[^」]+)」が、規約に定義されていません/, (m) => `designer__get_conventions で定義を確かめ、足すなら save_conventions (全体を渡す)。参照の綴りの誤りなら、式の ${m[1]} を直す`],
  [/工程の id「([^」]+)」が \d+ 回使われています/, (m) => `designer__list_steps で「${m[1]}」の工程を探し、update_step の patch で片方の id を別の id にする。jumpTo などでその工程を指している箇所があれば、合わせて直す`],
  [/道「[^」]*」の条件が空です/, () => "designer__get_step で分岐を確かめ、update_step で道の condition を書く。「上記以外」の道には条件は要らない (elseBranch に書く)。designer__analyze_branches で道の重なり・抜けも確かめる"],
  [/NG のときのレスポンス「([^」]+)」が|レスポンス「([^」]+)」が、このアクションの responses にありません/, () => "designer__get_process_flow でアクションの responses を確かめ、返したい応答を responses に足すか、responseId / ngResponseId を直す"],
  [/呼ぶ処理フロー「([^」]+)」がありません/, () => "designer__list_process_flows で処理フローの id を確かめ、画面項目のイベントの handlerFlowId を直す"],
  [/呼ぶアクション「([^」]+)」が、処理フロー/, () => "designer__get_process_flow でアクションの id を確かめ、イベントの handlerActionId を直す"],
  [/スキーマ: 「[^」]*」に、必須の項目「([^」]+)」がありません/, (m) => `update_step (処理フロー全体なら update_process_flow) で「${m[1]}」を足す。保存前の確認は validate_design。工程の種類ごとの必須の項目は docs/spec/process-flow-step-kinds.md、形の正本は Resource harmony://schema/<種類>`],
  [/スキーマ: .*(決められた値と違います|定義にない項目)/, () => "選べる値・項目は Resource harmony://schema/<種類> と docs/spec/schema-index.json で確かめ、validate_design で保存前に確かめながら直す。スキーマに表せない業務なら、拡張 (extensions/) か既存の項目で表す (スキーマは設計者の専権)"],
  [/JSON として読めません/, () => "designer__list_versions で保存前の版を探して designer__restore_version で戻すか、ファイルの JSON の誤りを直す"],
  [/一覧 \(harmony\.json\) にありますが、ファイル/, () => "designer__repair_registry (一覧の食い違いを直す) を使う。ファイルが必要なら designer__restore_version で戻す"],
  [/画面レイアウト \(業務部品\) が未作成です/, () => "designer__set_screen_layout で部品の木を作る (近い画面は designer__get_screen_layout で読む)"],
];

/** 指摘の直し方 (なければ null) */
export function issueHint(issue: HintableIssue): string | null {
  for (const [re, f] of RULES) {
    const m = re.exec(issue.message);
    if (m) return f(m);
  }
  return null;
}
