# Axis 07 — security review

## scope

OWASP top 10 / dual-use risk / runtime executor ban (TemplateString 仕様) / path traversal / prototype pollution / sensitive data leak を網羅。defensive security 視点のみ (offensive 用途は対象外)。

## 必須 step

### 1. path traversal

```bash
# user input の path 結合
grep -rnE "path\.(join|resolve)\([^)]*\b(req|args|input|userInput|name|id)\b" backend/src/ 2>&1 | head -30
# assertPathContained の coverage
grep -nE "assertPathContained" backend/src/projectStorage.ts | wc -l
# user input → path 結合の経路で assertPathContained が呼ばれていない箇所を特定
```

### 2. prototype pollution

```bash
# Object.assign / spread で user input を受けている
grep -rnE "Object\.assign\([^)]*req\b|\.\.\.req\.body" backend/src/ frontend/src/ 2>&1 | head -20
# JSON.parse 直後に直接構造 access (sanitize 無し)
grep -rnE "JSON\.parse\(.*\)\.(__proto__|constructor)" backend/src/ frontend/src/ 2>&1 | head -10
```

### 3. runtime executor ban (TemplateString 仕様)

docs/spec/process-flow-expression-language.md の `${...}` 内禁止 keyword:

```bash
# TemplateString runtime invocation 経路で eval / Function constructor / fetch 等を許す箇所
grep -rnE "new\s+Function\(|eval\(|setTimeout\([^,)]*\$\{|setInterval\([^,)]*\$\{" frontend/src backend/src 2>&1 | head -20
# 仕様: @flow.* / @action.* / @step.* の副作用 invocation を ${...} 内で呼ぶのは禁止 (dispatch rule)
```

### 4. sensitive data leak

```bash
# log で password / secret / token / key を出力
grep -rnE "console\.(log|info|warn|error)\([^)]*\b(password|secret|token|apiKey|cookie)\b" backend/src/ frontend/src/ 2>&1 | head -20
# logger / pino / console 経由で env や req body 全文を吐く箇所
grep -rnE "log\..*req\.body|console\..*process\.env\b" backend/src/ 2>&1 | head -20
```

### 5. CSP / iframe sandbox

```bash
grep -rnE "Content-Security-Policy|iframe.*sandbox" frontend/src backend/src 2>&1 | head -20
# GrapesJS canvas iframe / Puck preview iframe の sandbox 設定
```

### 6. XSS リスク (innerHTML / dangerouslySetInnerHTML)

```bash
grep -rnE "innerHTML\s*=|dangerouslySetInnerHTML" frontend/src/ 2>&1 | head -30
# 各 hit が sanitize されているか check
```

### 7. CORS / wsBridge origin check

```bash
grep -nE "origin\b|cors|Access-Control" backend/src/index.ts backend/src/wsBridge.ts 2>&1 | head -20
# 0.0.0.0 listen + origin check 無しのリスク
```

### 8. dependency vulnerabilities (info only)

```bash
cd frontend && npm audit --production --json 2>&1 | jq '.metadata.vulnerabilities' || true
cd ../backend && npm audit --production --json 2>&1 | jq '.metadata.vulnerabilities' || true
# 重大度 high / critical があれば release blocker
```

## 出力 format

findings.jsonl に append。severity は **慎重に**: 実 exploit 可能なら `must`、理論的余地なら `should` or `nit`。

## classification 指針

- 実 exploit 可能な path traversal / XSS / RCE → **issue** (release blocker 級、優先 max)
- 理論的 prototype pollution 余地 (深い nest が必要) → **issue** (should 級)
- sensitive data leak → **issue** (must or should、内容次第)
- iframe sandbox 強化 → **issue** (UI に副作用、慎重)
- dependency vulnerability → **issue** (auto-fix で `npm audit fix` できる場合のみ可、本 skill では原則 issue 化)
- CSP header の追加 → **spec-pending** (deploy 仕様変更、release 後 RFC)
- security 観点の docs/spec 追加 → **auto-fix**

## 完了判定

上記 8 step を 1 巡し、findings.jsonl 0 件追加で `completed`。

## 注意

system prompt の policy:

> Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes.

本軸は defensive のみ。発見した vulnerability の **exploit code は書かない**。再現方法は最小限の説明に留める。
