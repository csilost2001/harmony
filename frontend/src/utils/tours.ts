/**
 * 画面ごとの操作ツアー。画面の要素を順に光らせて、使い方を案内する (components/help/Tour.tsx)。
 * `target` は光らせる要素の CSS セレクタ。見つからない (いま画面に無い) 手順は、画面の中央に出す。
 * 文言は画面の実際の動きに合わせる (変えたらここも直す)。
 */
export interface TourStep { target?: string; title: string; body: string }
export interface Tour { id: string; title: string; steps: TourStep[] }

export const TOURS: Record<string, Tour> = {
  dashboard: {
    id: "dashboard",
    title: "ダッシュボード",
    steps: [
      { title: "ダッシュボードへようこそ", body: "プロジェクト全体の状況が、パネルで並んでいます。パネルの見出しをつかんで動かせます (キーボードでは、見出しで Alt+矢印)。" },
      { target: '[data-testid="panel-handle-getting-started"]', title: "はじめかた", body: "何から作ればよいかが、できた項目に印が付いて出ます。" },
      { target: '[data-testid="quick-open-trigger"]', title: "探して開く (Ctrl+K)", body: "画面・テーブル・処理フローを、名前や ID で探して開きます。「>」で始めると、保存・配色の切り替えなどの操作を探せます。" },
      { target: '[data-testid="favorites-open"]', title: "お気に入り", body: "よく使う設計を ★ で固定しておくと、ここから 1 クリックで開けます。" },
      { target: '[data-testid="notif-open"]', title: "通知の履歴", body: "消えてしまった通知 (保存・失敗) を見直せます。失敗した保存は、ここから「再試行」できます。" },
    ],
  },
  table: {
    id: "table",
    title: "テーブル編集",
    steps: [
      { target: ".table-editor-tabs", title: "タブ", body: "カラム・制約・インデックス・トリガー/デフォルト・コメントを切り替えます。カラムのタブが、いちばんよく使います。" },
      { target: ".columns-selection-bar", title: "カラムを選んで操作", body: "行をクリックして選び、上へ/下へ・複製・削除ができます。Ctrl+C / Ctrl+X / Ctrl+V は、別のテーブルへも運べます。" },
      { target: '[data-testid="columns-grid-toggle"]', title: "表で編集", body: "表計算ソフトのように、セルを選んでその場で編集します (Tab で次のセル、Enter で下の行)。" },
      { target: '[data-testid="columns-bulk-edit"]', title: "一括変更", body: "選んだカラムの型・長さ・NOT NULL などを、予行を見てからまとめて変えます。" },
      { target: ".columns-add-bar", title: "追加", body: "空のカラム・テンプレート (id や作成日時など)・Excel の表の貼り付けで、カラムを足します。" },
      { target: '[data-testid="editor-header-undo-redo"]', title: "元に戻す・変更履歴", body: "Ctrl+Z / Ctrl+Y のほかに、時計の印から、積まれた操作の一覧を開き、途中まで一度に戻せます。" },
    ],
  },
  "screen-items": {
    id: "screen-items",
    title: "画面項目",
    steps: [
      { target: ".screen-items-table", title: "項目の表", body: "画面の入力欄・表示欄を、1 行ずつ定義します。Enter で下の行、Tab で次の列へ移れます。見出しの「?」で、各列の意味を確かめられます。" },
      { target: ".screen-items-toolbar", title: "行をまとめて扱う", body: "行の左のチェックで選び、コピー・貼り付け (別の画面へも)・一括変更・スニペットとして保存ができます。" },
      { target: '[data-testid="paste-items-open"]', title: "表から貼り付け", body: "Excel の項目定義表を貼り付けて、項目をまとめて作れます。" },
      { target: '[data-testid="screen-items-rename-open-btn"]', title: "画面 ID の変更", body: "ID を変えると、参照している設計も一緒に直ります。" },
    ],
  },
  "process-flow": {
    id: "process-flow",
    title: "処理フロー編集",
    steps: [
      { target: ".process-flow-palette-pane", title: "ブロック", body: "入力チェック・DB アクセス・分岐などの工程を、クリックかドラッグで追加します。「スニペット」で、よく使う工程の並びを保存して再利用できます。" },
      { target: ".process-flow-canvas-pane", title: "工程を並べる", body: "上から順に実行されます。工程の見出しでは、↑↓ で移動、Insert で挿入、Tab / Shift+Tab で入れ子の出入り、Alt+↑↓ で並べ替えができます。" },
      { target: '[data-testid="editor-header-undo-redo"]', title: "元に戻す・変更履歴", body: "時計の印から、積まれた操作を一覧して、途中まで戻せます。" },
    ],
  },
  design: {
    id: "design",
    title: "画面デザイナ",
    steps: [
      { target: ".sld-left, .sld-palette", title: "部品", body: "見出し・入力欄・一覧・ボタンなどの部品を、クリックかドラッグで追加します。" },
      { target: ".sld-canvas, [data-testid=\"layout-canvas\"]", title: "紙面", body: "部品を入れ子に組み立てます。部品を選んで、↑↓ で前後の部品、← で親、→ で最初の子へ移れます。" },
      { target: ".sld-right", title: "詳細", body: "選んだ部品の詳細と、画面項目の定義を編集します。外へ出す / 中へ入れるボタン (Alt+←→) で、入れ子を組み替えられます。" },
    ],
  },
};

/** タブの種類 → ツアー (無ければ null) */
export function tourForTab(tabType: string | undefined): Tour | null {
  if (!tabType) return null;
  return Object.hasOwn(TOURS, tabType) ? TOURS[tabType] : null;
}
