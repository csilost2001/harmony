/**
 * 要確認の指摘に添える「どう直すか」(機械的な案内)。designer__check_design の応答の `hint`。
 * 指摘の文言の型から決める (指摘の元の検査は、文言を変えるとここが外れる — 試験 frontend/src/utils/integrity.test.ts が、規則ごとに実際の文言を通して、hint が付くことを見張る)。
 * 案内だけで、設計は書き換えない。AI は案内に従って直し、もう一度 check_design で確かめる。
 */
export interface HintableIssue { severity?: string; section?: string; message: string }

/** [指摘の文言, 直し方, (あれば) 指摘の対象 (section) が合うこと] */
const RULES: Array<[RegExp, (m: RegExpExecArray) => string, RegExp?]> = [
  // スキーマの参照の宣言 (x-ref-kind) による一般の指摘: 「/場所: テーブル「x」がありません (項目名)」
  [/^\/[^:]*: (テーブル|画面|処理フロー)「([^」]+)」がありません \((\w+)\)(?: — ほか \d+ か所)?$/, (m) => `designer__${m[1] === "テーブル" ? "list_tables" : m[1] === "画面" ? "list_screens" : "list_process_flows"} で正しい id を確かめ、指摘の場所 (先頭の /… は、その設計の中の位置) の「${m[3]}」を直す。${m[1]}「${m[2]}」が本当に要るなら、先にそれを作る`],
  [/呼び先の処理フロー「([^」]+)」の入力に、引数「([^」]+)」がありません/, (m) => `designer__get_process_flow で呼び先「${m[1]}」の actions[].inputs を確かめ、update_step の patch で argumentMapping のキーを入力の名前に直す (入力の側を足すなら update_process_flow)`],
  [/呼び先の処理フロー「([^」]+)」の必須の入力「([^」]+)」に、引数が渡されていません/, (m) => `update_step の patch で argumentMapping に「${m[2]}」の引数式を足す。呼び先「${m[1]}」でその入力が要らないなら、呼び先の inputs の required を外す`],
  [/変数「([^」]+)」は一覧 \(shape: list\) と宣言されていますが/, (m) => `designer__list_steps で「${m[1]}」を作る工程を探し、結果が 1 件なら update_step の patch で outputBinding.shape を "one" にする。一覧のままなら、読む側の式を添字 (@${m[1]}[0].項目) か繰り返しに直す`],
  [/変数「([^」]+)」は 1 件 \(shape: one\) と宣言されていますが/, (m) => `designer__list_steps で「${m[1]}」を作る工程を探し、結果が一覧なら update_step の patch で outputBinding.shape を "list" にする。1 件のままなら、読む側の式から添字・一覧の関数を外す`],
  [/テーブル「([^」]+)」がありません \(tableId\)/, (m) => `designer__list_tables で正しいテーブルの id を確かめ、update_step の patch に { "tableId": "<id>" } を入れて直す。テーブル「${m[1]}」を作るつもりなら add_table か import_ddl`],
  [/呼び出す画面「([^」]+)」がありません/, () => "designer__list_screens で画面の id を確かめ、get_process_flow で定義を読み、meta.screenId を直した完全な定義を update_process_flow の definition に渡す (呼び出す画面がないなら meta.screenId を消す)"],
  [/遷移先の画面「([^」]+)」がありません/, () => "designer__list_screens で画面の id を確かめ、update_step の patch で targetScreenId を直す"],
  [/結びつき先のテーブル「([^」]+)」がありません/, () => "designer__list_tables で正しいテーブルの id を確かめ、画面項目の binding.ref.tableId を直す。画面項目は編集セッションで直す (editSession__create { resourceType: \"screen-item\", resourceId: \"<画面の id>\" } → editSession__update で payload を直す → editSession__save)"],
  [/結びつき先のカラム「([^」]+)」が、テーブル/, () => "designer__get_table でカラムの id・physicalName を確かめ、画面項目の binding.ref.columnId を直す (画面項目は編集セッション: editSession__create { resourceType: \"screen-item\" } → editSession__update → editSession__save)"],
  [/外部キーの参照先のテーブル「([^」]+)」がありません/, () => "designer__list_tables で正しいテーブルの id を確かめ、get_table で定義を読み、constraints の referencedTableId を直した完全な定義を update_table の definition に渡す。参照先をまだ作らないなら、その制約に noConstraint: true"],
  [/外部キーの参照先のカラム「([^」]+)」が/, () => "designer__get_table で参照先のカラムの id を確かめ、get_table で定義を読み、referencedColumnIds を直した完全な定義を update_table の definition に渡す"],
  [/規約の[^「]+「(@conv\.[^」]+)」が、規約に定義されていません/, (m) => `designer__get_conventions で定義を確かめ、足すなら save_conventions (全体を渡す)。参照の綴りの誤りなら、式の ${m[1]} を直す`],
  [/工程の id「([^」]+)」が \d+ 回使われています/, (m) => `designer__list_steps で「${m[1]}」の工程を探し、update_step の patch で片方の id を別の id にする。jumpTo などでその工程を指している箇所があれば、合わせて直す`],
  [/道「[^」]*」の条件が空です/, () => "designer__get_step で分岐を確かめ、update_step で道の condition を書く。「上記以外」の道には条件は要らない (elseBranch に書く)。designer__analyze_branches で道の重なり・抜けも確かめる"],
  [/NG のときのレスポンス「([^」]+)」が|レスポンス「([^」]+)」が、このアクションの responses にありません/, () => "designer__get_process_flow でアクションの responses を確かめ、返したい応答を responses に足すか、responseId / ngResponseId を直す"],
  [/呼ぶ処理フロー「([^」]+)」がありません/, () => "designer__list_process_flows で処理フローの id を確かめ、画面項目のイベントの handlerFlowId を直す"],
  [/呼ぶアクション「([^」]+)」が、処理フロー/, () => "designer__get_process_flow でアクションの id を確かめ、イベントの handlerActionId を直す"],
  [/スキーマ: (?:「[^」]*」|全体)に、必須の項目「([^」]+)」がありません/, (m) => `update_step (処理フロー全体なら update_process_flow) で「${m[1]}」を足す。保存前の確認は validate_design。工程の種類ごとの必須の項目は docs/spec/process-flow-step-kinds.md、形の正本は Resource harmony://schema/<種類>`],
  [/スキーマ: .*(決められた値と違います|決められた選択肢にありません|型が違います|定義にない項目)/, () => "選べる値・項目は Resource harmony://schema/<種類> と docs/spec/schema-index.json で確かめ、validate_design で保存前に確かめながら直す。スキーマに表せない業務なら、拡張 (extensions/) か既存の項目で表す (スキーマは設計者の専権)"],
  [/JSON として読めません/, () => "designer__list_versions で保存前の版を探して designer__restore_version で戻すか、ファイルの JSON の誤りを直す", /(?:tables|process-flows|screens|sequences|views|view-definitions|business-flows|reports|page-layouts)\//],
  [/一覧 \(harmony\.json\) にありますが、ファイル/, () => "designer__repair_registry (一覧の食い違いを直す) を使う。ファイルが必要なら designer__restore_version で戻す"],
  [/画面レイアウト \(業務部品\) が未作成です/, () => "designer__set_screen_layout で部品の木を作る (近い画面は designer__get_screen_layout で読む)"],
];

/** 指摘の直し方 (なければ null) */
export function issueHint(issue: HintableIssue): string | null {
  for (const [re, f, sectionRe] of RULES) {
    const m = re.exec(issue.message);
    if (m && (!sectionRe || sectionRe.test(issue.section ?? ""))) return f(m);
  }
  return null;
}
