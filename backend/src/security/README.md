# backend/src/security/

接続・要求・AI (MCP) の権限の守り。仕様: `docs/spec/server-security.md`。

| ファイル | 内容 |
|---|---|
| `authToken.ts` | 接続トークン (`HARMONY_AUTH_TOKEN`) |
| `originCheck.ts` | Origin / Host の検査 |
| `requestLimits.ts` | 要求の大きさ・回数の上限 |
| `idValidator.ts` | id・名前のパス安全な形 (`assertEntityId` など) |
| `mcpAccess.ts` | AI に許す操作: 読み取り専用モード・拒否リスト。**読み取りの tool の許可リスト** (`READ_ONLY_TOOLS`) |
| `mcpProfiles.ts` | AI に見せる tool の絞り込み (権限ではない) |
