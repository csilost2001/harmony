/**
 * 入力欄の「?」から開く、項目ごとのヘルプ。短い説明と、くわしい仕様書の場所 (docs/ の下の Markdown)。
 * 仕様書はアプリの外 (リポジトリの docs/) にあるので、ここでは場所を示し、アプリの中だけで足りる説明を書く。
 * 文言は、画面の実際の動き・仕様書に合わせる (食い違うと混乱するので、仕様を変えたらここも直す)。
 */
export interface HelpTopic {
  title: string;
  /** 段落ごとの説明 */
  body: string[];
  /** くわしい仕様書 (リポジトリの docs/ の下) */
  doc?: string;
}

export const HELP_TOPICS: Record<string, HelpTopic> = {
  "table.physicalName": {
    title: "物理名",
    body: ["データベースの中での名前です。半角の英小文字・数字・アンダースコア (snake_case) で付けます。DDL にそのまま出ます。", "画面や処理が見るのは、ID と物理名です。あとから変えると、参照している設計に影響します (影響分析で確かめられます)。"],
    doc: "docs/spec/schema-v3-design.md",
  },
  "table.name": {
    title: "表示名",
    body: ["人が読む名前です (例: 顧客名)。設計書・画面・処理の説明に出ます。日本語で書いてかまいません。"],
    doc: "docs/spec/schema-v3-design.md",
  },
  "table.dataType": {
    title: "データ型",
    body: ["列に入れる値の種類です。VARCHAR・CHAR・DECIMAL・FLOAT は「長さ」を、DECIMAL は「スケール」(小数点以下の桁数) も決めます。", "DDL は、PostgreSQL・MySQL・Oracle・SQL Server などの書き方で確かめられます (DDL プレビュー)。"],
    doc: "docs/spec/schema-v3-design.md",
  },
  "table.keys": {
    title: "NOT NULL・主キー・ユニーク・自動採番",
    body: ["NOT NULL: 空を許さない。主キー (PK): 1 行を決める列 (つけると NOT NULL も付きます)。ユニーク (UK): 同じ値を 2 行に入れられない。自動採番 (AI): データベースが連番を振る。", "外部キーは、列ではなく「制約」タブで決めます。"],
    doc: "docs/spec/schema-v3-design.md",
  },
  "table.defaultValue": {
    title: "デフォルト値",
    body: ["値を入れなかったときに入る値です (例: 0、CURRENT_TIMESTAMP)。空なら、デフォルトなし。", "文字の値は、DDL に書くとき引用符で囲む必要があるか、データベースによって違うので、DDL プレビューで確かめてください。"],
    doc: "docs/spec/schema-v3-design.md",
  },
  "screenItem.id": {
    title: "項目 ID",
    body: ["画面の中で項目を区別する名前です。英字で始め、英数字だけで書きます (camelCase。例: customerName)。同じ画面の中で重ねられません。", "処理フローや画面デザインから、この ID で参照されます。変えるときは「ID 変更」を使うと、参照も一緒に直ります。"],
    doc: "docs/spec/screen-items.md",
  },
  "screenItem.label": {
    title: "ラベル",
    body: ["画面に出る項目の名前です (例: 顧客名)。エラーメッセージや設計書にも使われます。"],
    doc: "docs/spec/screen-items.md",
  },
  "screenItem.type": {
    title: "型",
    body: ["項目に入る値の種類です (文字列・数値・整数・真偽・日付・日時・JSON)。配列やオブジェクトは「型」の詳細で決めます。", "型によって、使える入力規則が変わります (最大長・最小長は文字列、最小値・最大値は数値)。"],
    doc: "docs/spec/screen-items.md",
  },
  "screenItem.direction": {
    title: "入出力",
    body: ["in: 画面から外へ渡す (入力欄・チェックなど)。out: 外から画面へ出す (表示欄・一覧など)。both: 双方向です。", "処理フローの入力・出力と突き合わせる検査に使います。"],
    doc: "docs/spec/screen-items.md",
  },
  "screenItem.required": {
    title: "必須",
    body: ["空のまま確定できない項目です。画面の入力チェックと、設計書のテスト観点 (空のときの扱い) に出ます。"],
    doc: "docs/spec/screen-items.md",
  },
  "screenItem.pattern": {
    title: "パターン",
    body: ["入力の形を決める正規表現です (例: 郵便番号なら ^[0-9]{3}-[0-9]{4}$)。", "プロジェクト共通の規約を使うときは、`@conv.regex.<キー>` のように規約カタログの名前で書けます。"],
    doc: "docs/spec/screen-items.md",
  },
  "processFlow.overview": {
    title: "処理フロー",
    body: ["ボタンを押したときなどの「契機」ごとに「アクション」を作り、そこへ「工程」(入力チェック・DB アクセス・分岐・外部呼び出しなど) を順に並べて書きます。", "左のブロックをクリックかドラッグで追加します。工程の見出しでは、キーボードで移動・挿入・入れ子の出入りができます (Alt+↑↓ で並べ替え)。"],
    doc: "docs/spec/process-flow-keyboard.md",
  },
  "layout.overview": {
    title: "画面デザイナ",
    body: ["画面は、座標ではなく「部品の入れ子」で組み立てます (見出し・入力欄・一覧・ボタンなど)。左の部品をクリックかドラッグで追加し、右の欄で詳細と画面項目を編集します。", "キーボード: ↑↓ で前後の部品、← で親、→ で最初の子を選び、Alt+↑↓ で並べ替え、Alt+←→ で入れ物の外へ・中へ動かします。"],
    doc: "docs/spec/screen-layout.md",
  },
  "analysis.suppress": {
    title: "要確認の抑制",
    body: ["意図どおりで、直さない指摘は、理由 (必須) と期限 (任意) を付けて抑制します。抑制は design-check.json に残り、git の差分でレビューできます。", "AI は要確認を黙らせません (人が理由つきで抑制します)。"],
    doc: "docs/spec/design-check.md",
  },
};

export function helpTopic(id: string): HelpTopic | null {
  return Object.hasOwn(HELP_TOPICS, id) ? HELP_TOPICS[id] : null;
}
