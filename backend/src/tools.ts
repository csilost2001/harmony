// #1374: editSession__create / editSession__list の resourceType enum を、
// editSessionStore.ts の source of truth (DRAFT_RESOURCE_TYPES) から導出する。
// 旧来 inline 列挙していた enum 配列が drift しやすく、実際 editSession__list 側に
// `page-layout` / `er-layout` / `generic-definition` が漏れて MCP enum と allowlist の
// 範囲が不一致になっていた。本配列 1 箇所の更新で型 / Set / MCP enum が同期する。
import { DRAFT_RESOURCE_TYPES } from "./editSessionStore.js";

export const tools = [
  // ── フロー図操作ツール ──

  {
    name: "designer__list_screens",
    description:
      "プロジェクトに登録されている画面 (Screen) の一覧を取得します。purpose で page (画面遷移図対象) / gadget (PageLayout 部品) を絞り込めます (RFC #1021)。",
    inputSchema: {
      type: "object" as const,
      properties: {
        // RFC #1021 pl-6 (Codex D-6): purpose filter 追加
        purpose: {
          type: "string",
          enum: ["page", "gadget"],
          description: "省略時は全件返却。'page' = 通常画面のみ、'gadget' = PageLayout 部品のみ",
        },
      },
      required: [],
    },
  },
  {
    name: "designer__add_screen",
    description:
      "フロー図に新しい画面ノードを追加します。追加後、ブラウザのフロー図に即時反映されます。" +
      " 新しい画面は、画面名の見出しだけを置いた業務部品レイアウト (layout) を持ちます。" +
      " 画面の中身は designer__set_screen_layout で設定してください。",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "画面名（例: 顧客一覧）",
        },
        type: {
          type: "string",
          enum: ["login","dashboard","list","detail","form","search","confirm","complete","error","modal","wizard","other"],
          description: "画面種別。省略時は other",
        },
        path: {
          type: "string",
          description: "想定URL（例: /customers）。省略可。",
        },
        position: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
          },
          description: "フロー図上の配置座標。省略時は自動配置。",
        },
        purpose: {
          type: "string",
          enum: ["page", "gadget"],
          description: "Screen 用途種別 (RFC #1021)。'page'（デフォルト）= 通常画面、'gadget' = PageLayout の region に割り当てる自律部品。",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "designer__update_screen",
    description:
      "既存画面のメタ情報 (名前・種別・説明・想定URL・purpose・pageLayoutId) を更新します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        screenId: {
          type: "string",
          description: "更新対象の画面ID（list_screens で取得）",
        },
        name: { type: "string", description: "新しい画面名" },
        type: {
          type: "string",
          enum: ["login","dashboard","list","detail","form","search","confirm","complete","error","modal","wizard","other"],
          description: "新しい画面種別",
        },
        description: { type: "string", description: "新しい説明" },
        path: { type: "string", description: "新しい想定URL (purpose=gadget の場合は省略可)" },
        purpose: {
          type: "string",
          enum: ["page", "gadget"],
          description: "Screen 用途種別 (RFC #1021)。'page'=通常画面 / 'gadget'=PageLayout の region に配置する自律部品",
        },
        pageLayoutId: {
          type: "string",
          description: "本 Screen が使用する PageLayout の ID (purpose=page のみ意味、空文字または null で解除)",
        },
      },
      required: ["screenId"],
    },
  },
  {
    name: "designer__remove_screen",
    description:
      "画面をフロー図から削除します。関連する遷移エッジとデザインデータも削除されます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        screenId: {
          type: "string",
          description: "削除する画面ID",
        },
      },
      required: ["screenId"],
    },
  },
  {
    name: "designer__add_edge",
    description:
      "2つの画面間に遷移エッジを追加します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        source: {
          type: "string",
          description: "遷移元の画面ID",
        },
        target: {
          type: "string",
          description: "遷移先の画面ID",
        },
        label: {
          type: "string",
          description: "遷移ラベル（例: 詳細ボタン）。省略可。",
        },
        trigger: {
          type: "string",
          enum: ["click","submit","select","cancel","auto","back","other"],
          description: "遷移トリガー。省略時は click",
        },
      },
      required: ["source", "target"],
    },
  },
  {
    name: "designer__remove_edge",
    description:
      "遷移エッジを削除します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        edgeId: {
          type: "string",
          description: "削除するエッジID（get_flow で取得）",
        },
      },
      required: ["edgeId"],
    },
  },
  {
    name: "designer__get_flow",
    description:
      "フロー図全体のデータ（全画面・全遷移エッジ）をJSON形式で取得します。プロジェクトの全体像を把握する際に使います。",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "designer__navigate_screen",
    description:
      "ブラウザを指定画面のデザイナーへ遷移させます。画面のデザインを編集する前に呼びます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        screenId: {
          type: "string",
          description: "遷移先の画面ID",
        },
      },
      required: ["screenId"],
    },
  },

  // ── 画面レイアウト (業務部品の木) とプロジェクト独自部品 ──

  {
    name: "designer__get_screen_layout",
    description:
      "画面の業務部品の木 (layout)・画面項目 (items)・検証結果 (issues) を取得します。" +
      "layout は section / form / search-panel / table / field / button 等の部品の入れ子で、field / table / button は itemRef で items を参照します。" +
      "type=component の部品はプロジェクト独自部品の参照 (componentRef + args) です。仕様: docs/spec/screen-layout.md",
    inputSchema: {
      type: "object" as const,
      properties: { screenId: { type: "string", description: "画面 ID (kebab-case)" } },
      required: ["screenId"],
    },
  },
  {
    name: "designer__set_screen_layout",
    description:
      "画面の layout (業務部品の木) を保存します。items を渡すと画面項目も置き換え、省略すると既存の items を保持します。" +
      "検証結果 (重複 ID・存在しない項目・置けない位置・未設定の差し込み口など) は保存を妨げず、counts と issues で返します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        screenId: { type: "string", description: "画面 ID (kebab-case)" },
        layout: { type: "object", description: "{ version: 1, nodes: LayoutNode[] }" },
        items: { type: "array", description: "画面項目 (省略時は既存を保持)", items: { type: "object" } },
      },
      required: ["screenId", "layout"],
    },
  },
  {
    name: "designer__list_layout_components",
    description:
      "プロジェクト独自部品 (layout-components.json) の定義一覧を、使用箇所 (画面・他の独自部品) と定義の検証結果つきで取得します。" +
      "独自部品は部品の木の断片に名前と差し込み口 (params: text / item / screen) を付けたもので、テンプレート内の {{paramId}} が画面側の args で置き換わります。" +
      "仕様: docs/spec/layout-components.md",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__save_layout_component",
    description:
      "プロジェクト独自部品を 1 件追加または置換します (id で照合、他の部品には触れません)。" +
      "定義にエラー (ID 不正・未定義の差し込み口の使用・循環など) があると保存しません。",
    inputSchema: {
      type: "object" as const,
      properties: {
        component: { type: "object", description: "{ id (kebab-case), label, description?, category?, params: [{id,label,kind,default?}], nodes: LayoutNode[] }" },
      },
      required: ["component"],
    },
  },
  {
    name: "designer__delete_layout_component",
    description: "プロジェクト独自部品を削除します。画面や他の独自部品から使われている場合は force: true を指定しない限り削除せず、使用箇所を返します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        componentId: { type: "string", description: "独自部品の ID" },
        force: { type: "boolean", description: "使用中でも削除する (使っている部品は「定義が見つかりません」になる)" },
      },
      required: ["componentId"],
    },
  },

  // ── 業務フロー (スイムレーン) ──

  {
    name: "designer__list_business_flows",
    description: "業務フロー (business-flows/) の一覧を取得します。各業務フローの ID・名前・レーン数・工程数・要確認の件数を返します。仕様: docs/spec/business-flow.md",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__get_business_flow",
    description: "業務フロー 1 件の原本 (レーン・工程・つながり) と検証結果を取得します。",
    inputSchema: {
      type: "object" as const,
      properties: { flowId: { type: "string", description: "業務フロー ID (kebab-case)" } },
      required: ["flowId"],
    },
  },
  {
    name: "designer__save_business_flow",
    description:
      "業務フロー 1 件を保存します (新規作成または置換)。誰が (lanes) 何をするか (steps) とそのつながり (steps[].next) を表します。" +
      "図の座標は持ちません (自動配置)。構造 (lanes / steps が配列) 以外の問題は保存を妨げず、検証結果として返します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        flowId: { type: "string", description: "業務フロー ID (kebab-case)。ファイル名になる" },
        flow: {
          type: "object",
          description: "{ name, description?, maturity?, lanes: [{id,name,kind?(person|system|external),roleRef?}], steps: [{id,lane,kind(start|task|decision|end),name,description?,screenRef?,processFlowRef?,next?:[{to,label?}]}] }",
        },
      },
      required: ["flowId", "flow"],
    },
  },
  {
    name: "designer__delete_business_flow",
    description: "業務フローを 1 件削除します。",
    inputSchema: {
      type: "object" as const,
      properties: { flowId: { type: "string", description: "業務フロー ID" } },
      required: ["flowId"],
    },
  },

  // ── テーブル設計書ツール ──

  {
    name: "designer__list_tables",
    description:
      "プロジェクトに定義されたテーブル設計書の一覧を取得します。各テーブルのID・テーブル名・論理名・カテゴリ・カラム数を返します。",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "designer__get_table",
    description:
      "指定テーブルの完全な定義（カラム・インデックス含む）を取得します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        tableId: {
          type: "string",
          description: "取得するテーブルのID（list_tables で取得）",
        },
      },
      required: ["tableId"],
    },
  },
  {
    name: "designer__add_table",
    description:
      "新しいテーブル定義を追加します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "テーブル名（snake_case、例: customers）",
        },
        logicalName: {
          type: "string",
          description: "論理名（例: 顧客マスタ）",
        },
        description: {
          type: "string",
          description: "テーブルの説明",
        },
        category: {
          type: "string",
          description: "カテゴリ（マスタ, トランザクション 等）。省略可。",
        },
      },
      required: ["name", "logicalName"],
    },
  },
  {
    name: "designer__update_table",
    description:
      "テーブル定義を更新します。カラムやインデックスを含む完全な定義を渡します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        tableId: {
          type: "string",
          description: "更新対象のテーブルID",
        },
        definition: {
          type: "object",
          description: "テーブル定義の完全なJSON（TableDefinition型）",
        },
      },
      required: ["tableId", "definition"],
    },
  },
  {
    name: "designer__remove_table",
    description:
      "テーブル定義を削除します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        tableId: {
          type: "string",
          description: "削除するテーブルID",
        },
      },
      required: ["tableId"],
    },
  },
  {
    name: "designer__list_page_layouts",
    description: "プロジェクトに定義された PageLayout の一覧を取得します。",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "designer__add_page_layout",
    description: "新しい PageLayout を追加します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "PageLayout の表示名（例: Main Layout）",
        },
        description: {
          type: "string",
          description: "用途説明（省略可）",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "designer__update_page_layout",
    description: "PageLayout を更新します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageLayoutId: {
          type: "string",
          description: "更新対象の PageLayout ID",
        },
        definition: {
          type: "object",
          description: "PageLayout の完全な定義",
        },
      },
      required: ["pageLayoutId", "definition"],
    },
  },
  {
    name: "designer__remove_page_layout",
    description: "PageLayout を削除します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageLayoutId: {
          type: "string",
          description: "削除する PageLayout ID",
        },
      },
      required: ["pageLayoutId"],
    },
  },
  {
    // RFC #1021 pl-6 (Codex D-2): get / save MCP tools 追加 (ISSUE #1023 受け入れ基準 6 種完備)
    name: "designer__get_page_layout",
    description: "PageLayout の完全な定義を ID で取得します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageLayoutId: { type: "string", description: "取得対象の PageLayout ID" },
      },
      required: ["pageLayoutId"],
    },
  },
  {
    name: "designer__save_page_layout",
    description: "PageLayout の完全な定義を保存します (update_page_layout より柔軟、AI 連携用)。",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageLayoutId: { type: "string", description: "保存対象の PageLayout ID" },
        data: { type: "object", description: "PageLayout の完全な JSON 定義" },
      },
      required: ["pageLayoutId", "data"],
    },
  },
  {
    name: "designer__generate_ddl",
    description:
      "指定テーブルのDDL（CREATE TABLE文）を生成します。SQLダイアレクトを指定できます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        tableId: {
          type: "string",
          description: "DDLを生成するテーブルID。省略で全テーブル。",
        },
        dialect: {
          type: "string",
          enum: ["mysql", "postgresql", "oracle", "sqlite", "standard"],
          description: "SQLダイアレクト。省略時は standard",
        },
      },
      required: [],
    },
  },

  // ── ER図ツール ──

  {
    name: "designer__get_er_diagram",
    description:
      "ER図データ（全テーブル・リレーション・Mermaid記法）を取得します。テーブル設計書の外部キー定義からリレーションを自動検出します。",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "designer__export_spec",
    description:
      "プロジェクトの統合仕様書をJSON形式で出力します。テーブル定義・リレーション（物理/論理/概念）・画面情報・画面遷移を含む、PG工程のAIエージェントが正確に解釈可能なフォーマットです。",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "designer__generate_er_mermaid",
    description:
      "Mermaid ER図記法を生成します。テーブル設計書の外部キー定義と論理リレーションから生成します。",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  // ── タブ管理・保存操作ツール ──

  {
    name: "designer__open_tab",
    description:
      "指定した画面またはテーブルをブラウザのタブで開きます。既に開いている場合はそのタブに切り替えます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        screenId: {
          type: "string",
          description: "開く画面のID（designer__list_screens で取得）",
        },
        tableId: {
          type: "string",
          description: "開くテーブルのID（designer__list_tables で取得）",
        },
      },
      required: [],
    },
  },
  {
    name: "designer__close_tab",
    description: "指定したタブを閉じます。未保存の変更がある場合は force: true で強制閉じできます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        tabId: {
          type: "string",
          description: "閉じるタブのID（designer__list_tabs で取得）",
        },
        force: {
          type: "boolean",
          description: "未保存の変更があっても強制的に閉じる（デフォルト: false）",
        },
      },
      required: ["tabId"],
    },
  },
  {
    name: "designer__list_tabs",
    description:
      "現在ブラウザで開いているタブの一覧と各タブの未保存状態を取得します。",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "designer__switch_tab",
    description: "指定したタブをアクティブにします。",
    inputSchema: {
      type: "object" as const,
      properties: {
        tabId: {
          type: "string",
          description: "アクティブにするタブのID（designer__list_tabs で取得）",
        },
      },
      required: ["tabId"],
    },
  },
  {
    name: "designer__save_screen",
    description:
      "指定した画面の変更をファイルに永続化します。ブラウザのキャッシュをサーバーのファイルに書き込みます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        screenId: {
          type: "string",
          description: "保存する画面のID",
        },
      },
      required: ["screenId"],
    },
  },
  {
    name: "designer__save_all",
    description:
      "未保存の変更がある全タブをまとめてファイルに永続化します。",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  // ── 処理フロー定義ツール ──

  {
    name: "designer__list_process_flows",
    description:
      "処理フロー定義（処理フロー）の一覧を取得します。画面・バッチ・共通処理等のタイプ別に管理されます。",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "designer__get_process_flow",
    description:
      "指定した処理フロー定義の詳細（アクション・ステップ含む）を取得します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: {
          type: "string",
          description: "取得する処理フローのID",
        },
      },
      required: ["processFlowId"],
    },
  },
  {
    name: "designer__add_process_flow",
    description:
      "新しい処理フロー定義（処理フロー）を作成します。生成される ID は kebab-case の EntityId (例: user-login-flow / monthly-batch)。不変識別子は別フィールド meta.uuid (UUID v4) に保持されます (RFC #1284 / #1332)。v3 schema (#1141) に従って meta/context/actions/authoring の 4 並列構造で保存されます。#1263 Phase X1: kind 引数は flowType に rename。",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "処理フロー名（例: ログイン画面、月次集計バッチ）",
        },
        flowType: {
          type: "string",
          enum: ["screen", "batch", "scheduled", "system", "common", "other"],
          description: "ProcessFlowKind 種別。v3 discriminator (#8 / #1141 / #1263 Phase X1: meta.kind → meta.flowType): screen=画面、batch=バッチ、scheduled=スケジュール起動、system=システム間、common=共通処理、other=その他。",
        },
        screenId: {
          type: "string",
          description: "紐付く Screen の EntityId (kebab-case、例: 'order-entry-screen')。flowType='screen' の場合に推奨。省略可。RFC #1284 / #1332 で UUID から EntityId 形式に変更。",
        },
        description: {
          type: "string",
          description: "処理フローの説明。省略可。",
        },
      },
      required: ["name", "flowType"],
    },
  },
  {
    name: "designer__update_process_flow",
    description:
      "処理フロー定義を更新します。アクション・ステップを含む完全な定義を渡します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: {
          type: "string",
          description: "更新対象の処理フローID",
        },
        definition: {
          type: "object",
          description: "処理フロー定義の完全なJSON（ProcessFlow型）",
        },
      },
      required: ["processFlowId", "definition"],
    },
  },
  {
    name: "designer__delete_process_flow",
    description:
      "処理フロー定義を削除します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: {
          type: "string",
          description: "削除する処理フローID",
        },
      },
      required: ["processFlowId"],
    },
  },
  {
    name: "designer__add_action",
    description:
      "処理フローにアクション（ボタンクリック等のイベント）を追加します。生成される action ID は LocalId (kebab-case、例: 'act-001' / 'act-002')。#1332 Codex 9 巡目 M3 で UUID v4 採番から LocalId 採番に修正 (schema Action.id は LocalId 規範)。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: {
          type: "string",
          description: "対象の処理フローの EntityId (kebab-case、例: 'user-login-flow')。",
        },
        name: {
          type: "string",
          description: "アクション名（例: 登録ボタン、検索ボタン）",
        },
        trigger: {
          type: "string",
          enum: ["click", "submit", "select", "change", "load", "timer", "auto", "other"],
          description: "トリガー種別 (auto = 画面ロード時に自動実行)",
        },
      },
      required: ["processFlowId", "name", "trigger"],
    },
  },
  {
    name: "designer__add_step",
    description:
      "アクションにステップ（処理手順）を追加します。生成される step ID は LocalId (kebab-case の短い識別子、例: 'step-01' / 'step-13b-a-01')。v3 schema (#1141) では discriminator は `kind` (旧 `type`) に統一されました。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: {
          type: "string",
          description: "対象の処理フローの EntityId (kebab-case、例: 'user-login-flow')。RFC #1284 / #1332 で UUID から EntityId 形式に変更。",
        },
        actionId: {
          type: "string",
          description: "対象のアクションの LocalId (kebab-case の短い識別子、例: 'act-001')",
        },
        kind: {
          type: "string",
          enum: ["validation", "dbAccess", "externalSystem", "commonProcess", "componentCall", "screenTransition", "displayUpdate", "branch", "loop", "loopBreak", "loopContinue", "jump", "compute", "return", "aiCall", "aiAgent", "transactionScope", "workflow", "eventPublish", "eventSubscribe", "log", "audit", "closing", "cdc"],
          description: "v3 ステップ discriminator (#8 / #1141 / #1187)。組み込み 24 variant に完全一致。拡張参照は `namespace:StepName` パターン (例: retail:OrderConfirm) を直接渡す (本 enum は組み込みのみ列挙、拡張は MCP 上は free string で受容)。",
        },
        description: {
          type: "string",
          description: "ステップの処理概要 (v3 schema 上多くの variant で必須)",
        },
        detail: {
          type: "object",
          description: "ステップ種別固有の詳細（tableId, operation, sql 等）。省略可。",
        },
        position: {
          type: "number",
          description: "挿入位置 (0-based index)。省略時は末尾。",
        },
      },
      required: ["processFlowId", "actionId", "kind", "description"],
    },
  },
  {
    name: "designer__update_step",
    description:
      "既存ステップの任意フィールドをパッチ更新します。patch にマージされます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: { type: "string" },
        stepId: { type: "string", description: "更新対象の step id (全アクションのネストも走査)" },
        patch: { type: "object", description: "マージするオブジェクト。空オブジェクトは no-op。" },
      },
      required: ["processFlowId", "stepId", "patch"],
    },
  },
  {
    name: "designer__remove_step",
    description: "ステップを削除します。ネスト (branch/loop/subSteps/outcomes.sideEffects) も走査。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: { type: "string" },
        stepId: { type: "string" },
      },
      required: ["processFlowId", "stepId"],
    },
  },
  {
    name: "designer__move_step",
    description: "ステップを同一配列内で並び替えます。異なる親への移動は未対応。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: { type: "string" },
        stepId: { type: "string" },
        newIndex: { type: "number" },
      },
      required: ["processFlowId", "stepId", "newIndex"],
    },
  },
  {
    name: "designer__set_maturity",
    description: "ステップ / アクション / 処理フローの maturity を更新します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: { type: "string" },
        target: { type: "string", enum: ["group", "action", "step"], description: "設定対象" },
        targetId: { type: "string", description: "target=action/step のとき必須" },
        maturity: { type: "string", enum: ["draft", "provisional", "committed"] },
      },
      required: ["processFlowId", "target", "maturity"],
    },
  },
  {
    name: "designer__add_step_note",
    description: "ステップに付箋 (StepNote) を追加します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: { type: "string" },
        stepId: { type: "string" },
        kind: { type: "string", enum: ["assumption", "prerequisite", "todo", "deferred", "question"], description: "Note 種別 (common.v3 Note.kind と同名・同値)" },
        body: { type: "string" },
      },
      required: ["processFlowId", "stepId", "kind", "body"],
    },
  },
  {
    name: "designer__list_response_type_extensions",
    description: "response-types.json に登録されているレスポンス型拡張を一覧します。",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__get_response_type_extension",
    description: "response-types.json のレスポンス型拡張を 1 件取得します。",
    inputSchema: {
      type: "object" as const,
      properties: { key: { type: "string" } },
      required: ["key"],
    },
  },
  {
    name: "designer__add_response_type_extension",
    description: "response-types.json にレスポンス型拡張を追加します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string" },
        key: { type: "string" },
        schema: { type: "object" },
        description: { type: "string" },
      },
      required: ["key", "schema"],
    },
  },
  {
    name: "designer__update_response_type_extension",
    description: "response-types.json のレスポンス型拡張を更新します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        key: { type: "string" },
        schema: { type: "object" },
        description: { type: "string" },
      },
      required: ["key"],
    },
  },
  {
    name: "designer__delete_response_type_extension",
    description: "response-types.json からレスポンス型拡張を削除します。",
    inputSchema: {
      type: "object" as const,
      properties: { key: { type: "string" } },
      required: ["key"],
    },
  },
  {
    name: "designer__list_extension_packages",
    description: "data/extensions/*.json の拡張パッケージ一覧を取得します。",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__get_extension_package",
    description: "指定した拡張パッケージを取得します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        packageName: {
          type: "string",
          enum: ["steps", "fieldTypes", "triggers", "dbOperations", "responseTypes"],
        },
      },
      required: ["packageName"],
    },
  },
  {
    name: "designer__add_catalog_entry",
    description: "ProcessFlow レベルのカタログ (errorCatalog / secretsCatalog / externalSystemCatalog) にエントリを追加・更新します。typeCatalog は add_response_type_extension に転送されます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: { type: "string" },
        catalog: {
          type: "string",
          enum: ["errorCatalog", "secretsCatalog", "externalSystemCatalog"],
        },
        key: { type: "string", description: "エントリキー (例: STOCK_SHORTAGE / stripeApiKey / ApiError / stripe)" },
        value: { type: "object", description: "エントリの値。全体置換。" },
      },
      required: ["processFlowId", "catalog", "key", "value"],
    },
  },
  {
    name: "designer__remove_catalog_entry",
    description: "ProcessFlow カタログからエントリを削除します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: { type: "string" },
        catalog: {
          type: "string",
          enum: ["errorCatalog", "secretsCatalog", "externalSystemCatalog"],
        },
        key: { type: "string" },
      },
      required: ["processFlowId", "catalog", "key"],
    },
  },
  {
    name: "designer__list_markers",
    description: "ProcessFlow の人間→AI マーカー (指示・質問・TODO・チャット) を取得します。/designer-work の最初に呼ぶ想定。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: { type: "string" },
        unresolvedOnly: { type: "boolean", description: "true で未解決のみ (既定 true)" },
        stepId: { type: "string", description: "特定 step の marker のみ取得" },
      },
      required: ["processFlowId"],
    },
  },
  {
    name: "designer__find_all_markers",
    description: "全 ProcessFlow を横断して未解決マーカーを取得します。/designer-work で「今対応すべき人間指示をまず一望する」ために使用。各マーカーに processFlowId / processFlowName が付く。",
    inputSchema: {
      type: "object" as const,
      properties: {
        unresolvedOnly: { type: "boolean", description: "true で未解決のみ (既定 true)" },
        kind: {
          type: "string",
          enum: ["chat", "attention", "todo", "question"],
          description: "特定 kind のみ抽出 (省略時は全 kind)",
        },
      },
    },
  },
  {
    name: "designer__add_marker",
    description: "ProcessFlow にマーカーを追加します。AI 側からの質問・返信・報告等を人間に届ける用途。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: { type: "string" },
        kind: { type: "string", enum: ["chat", "attention", "todo", "question"], description: "Marker 種別 (schema の \"validator\" は意図的に除外 — validator marker は validator runtime のみが追加可能、AI 手動付与は想定外)" },
        body: { type: "string" },
        stepId: { type: "string", description: "紐付ける step id (省略時はグループ全体宛)" },
        fieldPath: { type: "string" },
        author: { type: "string", enum: ["human", "ai"], description: "既定 \"ai\"" },
      },
      required: ["processFlowId", "kind", "body"],
    },
  },
  {
    name: "designer__resolve_marker",
    description: "マーカーを解決済みにします。resolution コメントを付与して人間に応答内容を伝える。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: { type: "string" },
        markerId: { type: "string" },
        resolution: { type: "string", description: "AI 側の対応メモ (例: \"sql を修正しました\")" },
      },
      required: ["processFlowId", "markerId"],
    },
  },
  // ── 画面項目 ID リネーム ──

  {
    name: "designer__get_rename_context",
    description:
      "指定画面の未命名画面項目 (自動生成 ID のもの) と周辺 HTML コンテキストを返します。" +
      "呼び出し元 (Claude) がこの情報を基に {oldId: newId} マッピングを推論し、" +
      "designer__apply_rename_mapping で適用します。命名済み項目は含まれません。",
    inputSchema: {
      type: "object" as const,
      properties: {
        screenId: { type: "string", description: "対象の画面 ID" },
      },
      required: ["screenId"],
    },
  },

  {
    name: "designer__apply_rename_mapping",
    description:
      "画面項目 ID を一括リネームします。mapping の各エントリに対して rename_screen_item を順次実行し、" +
      "処理フローの screenItemRef も自動追従します。1 件の失敗は後続エントリの処理を止めません。",
    inputSchema: {
      type: "object" as const,
      properties: {
        screenId: { type: "string", description: "対象の画面 ID" },
        mapping: {
          type: "object",
          description: "{oldId: newId} 形式のマッピング。newId は camelCase の有効な JS 識別子 (30 字以内)。",
          additionalProperties: { type: "string" },
        },
      },
      required: ["screenId", "mapping"],
    },
  },

  {
    name: "designer__rename_screen_item",
    description:
      "画面項目の ID を変更し、参照する全処理フローの screenItemRef を自動追従させます。" +
      "oldId → newId のリネームが画面 HTML の name/id 属性と screen-items JSON にも反映されます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        screenId: { type: "string", description: "対象の画面ID" },
        oldId:    { type: "string", description: "変更前の業務識別子" },
        newId:    { type: "string", description: "変更後の業務識別子 (有効な JS 識別子)" },
      },
      required: ["screenId", "oldId", "newId"],
    },
  },

  {
    name: "designer__check_screen_item_refs",
    description:
      "画面項目 ID を変更したときに影響を受ける処理フローの一覧と件数を返します。" +
      "rename_screen_item の実行前に呼び出して影響範囲を確認するために使います。",
    inputSchema: {
      type: "object" as const,
      properties: {
        screenId: { type: "string", description: "対象の画面ID" },
        itemId:   { type: "string", description: "確認する業務識別子" },
      },
      required: ["screenId", "itemId"],
    },
  },

  {
    name: "designer__remove_marker",
    description: "マーカーを完全削除します (resolve とは別、履歴から消す)。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: { type: "string" },
        markerId: { type: "string" },
      },
      required: ["processFlowId", "markerId"],
    },
  },

  {
    name: "designer__export_arazzo",
    description:
      "ProcessFlow 内の ExternalSystemStep を Arazzo 1.0 YAML / JSON として出力します。" +
      "フロー中の外部 API 呼び出しを Arazzo ワークフロー形式にエクスポートし、OpenAPI ツールとの連携に利用できます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowId: {
          type: "string",
          description: "対象フロー ID",
        },
        outputFormat: {
          type: "string",
          enum: ["yaml", "json"],
          description: "出力形式。デフォルト: yaml",
        },
      },
      required: ["processFlowId"],
    },
  },

  {
    name: "designer__solution_pack",
    description:
      "指定した処理フロー群を solution ZIP ファイルにパッケージングします。" +
      "プロジェクト間でフロー定義を配布・共有するための pack 機能 (Power Platform Solution 相当)。",
    inputSchema: {
      type: "object" as const,
      properties: {
        processFlowIds: {
          type: "array",
          items: { type: "string" },
          description: "ZIP に同梱するフロー ID の配列",
        },
        publisherPrefix: {
          type: "string",
          description: "プロジェクト識別子 (ID 衝突防止プレフィックス, 例: myapp)",
        },
        version: {
          type: "string",
          description: "バージョン文字列 (例: 1.0.0)",
        },
        outputPath: {
          type: "string",
          description: "出力先 .zip パス (絶対パスまたは data/ からの相対パス)",
        },
      },
      required: ["processFlowIds", "publisherPrefix", "version", "outputPath"],
    },
  },

  {
    name: "designer__solution_unpack",
    description:
      "solution ZIP ファイルを展開し、フロー定義を data/actions/ に取り込みます。" +
      "solution_pack で作成した ZIP を別プロジェクトで展開する unpack 機能。",
    inputSchema: {
      type: "object" as const,
      properties: {
        inputPath: {
          type: "string",
          description: "展開する .zip パス (絶対パスまたは data/ からの相対パス)",
        },
        conflictResolution: {
          type: "string",
          enum: ["skip", "overwrite", "rename"],
          description: "ID 衝突時の解決方針。skip: 既存を維持 / overwrite: 上書き / rename: プレフィックス付きで保存。デフォルト: skip",
        },
        publisherPrefix: {
          type: "string",
          description: "conflictResolution=rename 時に ID の先頭に付与するプレフィックス (例: myapp)。省略時は \"imported\"",
        },
      },
      required: ["inputPath"],
    },
  },

  // ── 拡張ポイント 専用ツール (#445) ──

  {
    name: "designer__add_step_extension",
    description: "data/extensions/steps.json にステップ拡張を追加します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "名前空間 (空文字列可)" },
        key: { type: "string", description: "ステップキー (例: BatchStep)" },
        schema: { type: "object", description: "動的フォーム生成スコープのサブセット" },
        label: { type: "string" },
        icon: { type: "string" },
        description: { type: "string" },
      },
      required: ["namespace", "key", "schema"],
    },
  },

  {
    name: "designer__add_field_type_extension",
    description: "data/extensions/field-types.json にフィールド型拡張を追加します。既存 kind は上書きします。",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "名前空間" },
        kind: { type: "string", description: "FieldType の kind 値" },
        label: { type: "string" },
      },
      required: ["namespace", "kind", "label"],
    },
  },

  {
    name: "designer__add_trigger_extension",
    description: "data/extensions/triggers.json にトリガー拡張を追加します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "名前空間" },
        value: { type: "string", description: "ActionTrigger の enum 値 (例: webhook, mq)" },
        label: { type: "string", description: "UI 表示ラベル (日本語可)" },
      },
      required: ["namespace", "value", "label"],
    },
  },

  {
    name: "designer__add_db_operation_extension",
    description: "data/extensions/db-operations.json に DB 操作拡張を追加します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        namespace: { type: "string", description: "名前空間" },
        value: { type: "string", description: "DbOperation の enum 値 (例: TRUNCATE, MERGE)" },
        label: { type: "string", description: "UI 表示ラベル (日本語可)" },
      },
      required: ["namespace", "value", "label"],
    },
  },

  {
    name: "designer__remove_extension",
    description: "拡張エントリを 1 件削除します。type に応じたファイルから該当エントリを取り除きます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          enum: ["steps", "fieldTypes", "triggers", "dbOperations", "responseTypes"],
          description: "拡張種別",
        },
        namespace: { type: "string", description: "名前空間" },
        key: { type: "string", description: "steps / responseTypes 用キー" },
        value: { type: "string", description: "fieldTypes:kind / triggers:value / dbOperations:value" },
      },
      required: ["type", "namespace"],
    },
  },

  {
    name: "designer__list_extensions",
    description: "data/extensions/ の全拡張 (steps / fieldTypes / triggers / dbOperations / responseTypes) を一括取得します。",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },

  // ── ワークスペース管理 (#671) ─────────────────────────────────────
  {
    name: "designer__workspace_list",
    description: "最近使ったワークスペース一覧と現在 active なワークスペース、lockdown 状態を返します。",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__workspace_status",
    description: "現在 active なワークスペースの絶対パス・名前・lockdown フラグを返します。",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__workspace_open",
    description: "指定 path または id のワークスペースを active にし、recent に upsert します。init=true 指定時は path のフォルダを作成し harmony.json を初期化してから open します。lockdown モード時は error を返します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "ワークスペースの絶対パス。id と排他、どちらか必須。" },
        id: { type: "string", description: "recent 上の workspace id。path と排他。" },
        init: { type: "boolean", description: "true の場合、path のフォルダ作成と harmony.json 初期化を行ってから open します (path 必須)。" },
        dataDir: { type: "string", description: "init=true 時のデータディレクトリ名 (省略時: 'harmony')。harmony.json の dataDir フィールドに設定されます。" },
      },
      required: [],
    },
  },
  {
    name: "designer__workspace_inspect",
    description: "指定 path のフォルダ状態を判定して返します。status は 'ready' (harmony.json あり + schema 検証 pass), 'needsInit' (harmony.json なし), 'notFound' (フォルダ無し), 'invalid' (harmony.json が JSON 不正 or schema 違反) のいずれか。",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "判定対象の絶対パス" },
      },
      required: ["path"],
    },
  },
  {
    name: "designer__workspace_close",
    description: "現在 active なワークスペースを閉じます (active = null)。lockdown モード時は error を返します。",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "designer__workspace_remove",
    description: "recent からワークスペースエントリを除外します (fs は変更しません)。lockdown モード時は error を返します。",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "recent 上の workspace id" },
      },
      required: ["id"],
    },
  },
  // draft__ / lock__ tools 削除済 (Phase 6 #903)
  // 旧 draft__read / draft__update / draft__commit / draft__discard / draft__has / draft__list /
  // lock__acquire / lock__release / lock__forceRelease / lock__get / lock__list は Phase 6 (#903) で削除。
  // editSession.* API が正規経路。

  // ── EditSession MCP tools (#906) ──────────────────────────────────────────────
  // AI エージェント (MCP 経由) が edit-session を直接操作するための tool 群。
  // 旧 draft__/lock__ の MCP tool 削除に伴う後継。実装は wsBridge の editSession* 公開 API
  // を adapter として呼ぶ (WS handler と共有)。spec docs/spec/edit-session-protocol.md 準拠。
  {
    name: "editSession__create",
    description:
      "新規 EditSession を作成して initial Edit participant として登録します。" +
      "指定 resource (画面 / テーブル / 処理フロー等) の編集セッションを開始する際に使います。",
    inputSchema: {
      type: "object" as const,
      properties: {
        resourceType: {
          type: "string",
          // #1374: editSessionStore.ts の DRAFT_RESOURCE_TYPES (source of truth) から
          // 直接参照。旧 inline 列挙は #1368 で `generic-definition` 等の追加追従漏れが
          // 発生していた (MCP enum と runtime allowlist の drift)。
          enum: [...DRAFT_RESOURCE_TYPES],
          description: "編集対象 resource の種別",
        },
        resourceId: { type: "string", description: "編集対象 resource の ID (singleton resource は \"singleton\" 等)" },
        displayLabel: { type: "string", description: "participant の表示名 (例: \"@alice\" / \"AI@bot\")。省略時は sessionId" },
      },
      required: ["resourceType", "resourceId"],
    },
  },
  {
    name: "editSession__attach_as_view",
    description:
      "既存 EditSession に View role で attach します。response に現在の payload + sequence が含まれます。" +
      "別エージェントが編集中の resource を観察 / 引き継ぎ準備する際に使います。",
    inputSchema: {
      type: "object" as const,
      properties: {
        editSessionId: { type: "string", description: "対象 EditSession の ID" },
        displayLabel: { type: "string", description: "participant の表示名。省略時は sessionId" },
        parentHumanSessionId: { type: "string", description: "AI participant の場合、指示元 human の sessionId" },
      },
      required: ["editSessionId"],
    },
  },
  {
    name: "editSession__detach",
    description:
      "EditSession から完全離脱します。Edit role の場合は事前に View に降格 (set_role) する必要があります。",
    inputSchema: {
      type: "object" as const,
      properties: {
        editSessionId: { type: "string", description: "対象 EditSession の ID" },
      },
      required: ["editSessionId"],
    },
  },
  {
    name: "editSession__set_role",
    description:
      "自身の participant role を変更します。通常は take-over (transfer_edit) を使い、本 tool は限定的な role 変更用 (Edit → View 降格等)。",
    inputSchema: {
      type: "object" as const,
      properties: {
        editSessionId: { type: "string", description: "対象 EditSession の ID" },
        role: { type: "string", enum: ["Edit", "View"], description: "新しい role" },
      },
      required: ["editSessionId", "role"],
    },
  },
  {
    name: "editSession__transfer_edit",
    description:
      "Edit role を atomic に take-over します。caller が new Edit holder になり、現 Edit holder は View に降格します。" +
      "事前に attach_as_view で View 参加していること (spec §7.2)。",
    inputSchema: {
      type: "object" as const,
      properties: {
        editSessionId: { type: "string", description: "対象 EditSession の ID" },
      },
      required: ["editSessionId"],
    },
  },
  {
    name: "editSession__update",
    description:
      "EditSession の payload を更新し sequence を increment します。FS write はせず in-memory snapshot のみ更新 (Forward-Compat 原則)。" +
      "AI が draft 編集を反映する際に使います。",
    inputSchema: {
      type: "object" as const,
      properties: {
        editSessionId: { type: "string", description: "対象 EditSession の ID" },
        payload: { description: "新しい payload (opaque、resourceType ごとに schema が異なる)" },
      },
      required: ["editSessionId", "payload"],
    },
  },
  {
    name: "editSession__save",
    description:
      "EditSession の現時点 payload を本体ファイルに確定保存します (saveHistory 記録 + broadcast 含む)。" +
      "spec §9.3 last-save-wins: 衝突時は { ok: false, conflict } を返します。" +
      "stage パラメータで 2 段階保存をサポート (checkOnly / commit)。",
    inputSchema: {
      type: "object" as const,
      properties: {
        editSessionId: { type: "string", description: "対象 EditSession の ID" },
        force: { type: "boolean", description: "true で衝突 check skip (overwrite 確認後)" },
        stage: {
          type: "string",
          enum: ["checkOnly", "commit"],
          description: "checkOnly = 衝突 check のみ / commit = saveHistory 記録 + broadcast (衝突 check skip)",
        },
      },
      required: ["editSessionId"],
    },
  },
  {
    name: "editSession__discard",
    description:
      "EditSession を Active → Discarded に遷移させます。draft が破棄され retention 期間 (7日) 後に完全削除されます。",
    inputSchema: {
      type: "object" as const,
      properties: {
        editSessionId: { type: "string", description: "対象 EditSession の ID" },
      },
      required: ["editSessionId"],
    },
  },
  {
    name: "editSession__list",
    description:
      "EditSession 一覧を取得します。resourceType + resourceId 指定で絞り込み、未指定で全件返却。",
    inputSchema: {
      type: "object" as const,
      properties: {
        resourceType: {
          type: "string",
          // #1374: editSessionStore.ts の DRAFT_RESOURCE_TYPES (source of truth) を共有。
          // 旧 inline 列挙は editSession__create 側と drift しており、`page-layout` /
          // `er-layout` / `generic-definition` の 3 type が漏れて MCP `editSession__list`
          // から filter できなくなっていた。
          enum: [...DRAFT_RESOURCE_TYPES],
          description: "絞り込み: resource 種別",
        },
        resourceId: { type: "string", description: "絞り込み: resource ID (resourceType と同時指定)" },
      },
      required: [],
    },
  },
  {
    name: "editSession__fetch_payload",
    description:
      "EditSession の現在の payload + sequence を取得します (broadcast 待ちなし)。" +
      "別 session が attach した直後の initial fetch や、cross-session take-over 後の同期に使います。",
    inputSchema: {
      type: "object" as const,
      properties: {
        editSessionId: { type: "string", description: "対象 EditSession の ID" },
      },
      required: ["editSessionId"],
    },
  },
];
