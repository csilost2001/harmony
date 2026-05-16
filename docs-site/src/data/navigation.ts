export type NavItem = { id: string; title: string };
export type NavGroup = { title: string; items: NavItem[] };

export const navigation: Record<string, NavGroup[]> = {
  spec: [
    {
      title: 'Overview',
      items: [
        { id: 'readme', title: 'Spec Index (README)' },
      ],
    },
    {
      title: 'ProcessFlow',
      items: [
        { id: 'process-flow-workflow', title: 'Overview' },
        { id: 'process-flow-variables', title: '変数' },
        { id: 'process-flow-expression-language', title: '式言語' },
        { id: 'process-flow-criterion', title: '条件 (Criterion)' },
        { id: 'process-flow-runtime-conventions', title: 'Runtime 規約' },
        { id: 'process-flow-transaction', title: 'トランザクション' },
        { id: 'process-flow-sla', title: 'SLA' },
        { id: 'process-flow-tier-c', title: 'Tier-C (高可用)' },
        { id: 'process-flow-external-system', title: '外部システム' },
        { id: 'process-flow-secrets', title: 'Secrets' },
        { id: 'process-flow-env-vars', title: '環境変数' },
        { id: 'process-flow-ai-step-kind', title: 'AI step kind' },
        { id: 'process-flow-testing', title: 'Testing' },
        { id: 'process-flow-maturity', title: '成熟度 (maturity)' },
        { id: 'process-flow-extensions', title: '拡張機構' },
      ],
    },
    {
      title: 'Schema',
      items: [
        { id: 'schema-governance', title: 'Governance (最重要)' },
        { id: 'schema-design-principles', title: '設計原則' },
        { id: 'schema-v3-design', title: 'V3 設計記録' },
        { id: 'schema-audit-2026-04-27', title: '監査記録 (2026-04-27)' },
      ],
    },
    {
      title: 'Screen / Layout / View',
      items: [
        { id: 'screen-items', title: '画面項目定義' },
        { id: 'page-layout', title: 'PageLayout' },
        { id: 'view-definition', title: 'ViewDefinition' },
        { id: 'list-common', title: '一覧共通仕様' },
        { id: 'multi-editor-puck', title: 'マルチエディタ (Puck)' },
        { id: 'css-framework-switching', title: 'CSS framework 切替' },
        { id: 'generic-definition-layer', title: '汎用定義レイヤ' },
      ],
    },
    {
      title: 'Workspace / Edit Session',
      items: [
        { id: 'workspace', title: 'Workspace' },
        { id: 'workspace-multi', title: 'マルチワークスペース' },
        { id: 'edit-session-draft', title: 'Edit session draft' },
        { id: 'edit-session-protocol', title: 'Edit session protocol' },
        { id: 'collab-presence', title: '協業 presence (一部 obsolete)' },
      ],
    },
    {
      title: 'Plugin / Extension',
      items: [
        { id: 'plugin-system', title: 'プラグインシステム' },
      ],
    },
    {
      title: 'Code Generation / Testing',
      items: [
        { id: 'code-generation', title: 'コード生成' },
        { id: 'conversion-guideline-for-ai', title: 'AI 変換ガイドライン' },
        { id: 'e2e-vite-stability', title: 'E2E Vite 安定性' },
      ],
    },
    {
      title: 'Examples',
      items: [
        { id: 'examples-retail', title: '小売業サンプル' },
        { id: 'examples-english-learning', title: '英語学習アプリサンプル' },
        { id: 'sample-project-structure', title: 'サンプル project 構造' },
      ],
    },
    {
      title: 'Path / Policy',
      items: [
        { id: 'path-conventions', title: 'パス規約' },
        { id: 'draft-state-policy', title: 'Draft-state policy' },
      ],
    },
    {
      title: 'Audit Reports',
      items: [
        { id: '_audit-2026-05-17', title: 'docs/ 監査 (2026-05-17)' },
      ],
    },
    {
      title: 'Dogfood / Phase Evaluation (Archive)',
      items: [
        { id: 'phase2-evaluation-2026-04-30', title: 'Phase 2 評価' },
        { id: 'phase3-evaluation-2026-04-30', title: 'Phase 3 評価' },
        { id: 'phase4-evaluation-2026-04-30', title: 'Phase 4 評価' },
        { id: 'dogfood-2026-04-26-finance', title: '金融 dogfood' },
        { id: 'dogfood-2026-04-26-manufacturing', title: '製造 dogfood' },
        { id: 'dogfood-2026-04-27-logistics-create-flow-validation', title: '物流 create-flow 検証' },
        { id: 'dogfood-2026-04-27-phase4-retail-validation', title: 'Phase 4 retail 検証' },
        { id: 'dogfood-2026-04-29-phase2-validator-audit', title: 'Phase 2 validator audit' },
        { id: 'dogfood-2026-04-30-phase2-healthcare-welfare', title: 'Phase 2 医療/福祉' },
        { id: 'dogfood-2026-05-04-english-learning', title: '英語学習 dogfood' },
        { id: 'dogfood-2026-05-05-multi-editor-puck', title: 'マルチエディタ dogfood' },
      ],
    },
  ],
  'user-guide': [
    {
      title: 'ユーザーガイド',
      items: [
        { id: 'readme', title: 'Overview' },
        { id: 'process-flow-workflow', title: 'ProcessFlow ワークフロー' },
        { id: 'marker-workflow', title: 'Marker ワークフロー' },
        { id: 'rename-screen-ids-workflow', title: '画面 ID リネーム' },
        { id: 'multi-editor-puck-guide', title: 'マルチエディタ利用' },
        { id: 'troubleshooting', title: 'トラブルシューティング' },
      ],
    },
  ],
  conventions: [
    {
      title: '規約カタログ',
      items: [
        { id: 'expressions', title: '式言語規約 (@conv/@env/@secret)' },
        { id: 'product-scope', title: 'プロダクトスコープ' },
        { id: 'validation-rules', title: 'バリデーション規約' },
      ],
    },
  ],
  setup: [
    {
      title: 'セットアップ',
      items: [
        { id: 'dev-containers', title: 'Dev Containers (推奨)' },
        { id: 'wsl2-native', title: 'WSL2 native (代替)' },
        { id: 'distribution-roadmap', title: '配布構想 (将来)' },
      ],
    },
  ],
};
