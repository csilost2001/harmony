# Axis 05 — frontend store / persistence

## scope

`frontend/src/store/*.ts` の **autosave / fallback / dirty-check / localStorage 廃止後の残骸** を網羅検査。#923-#928 シリーズ で localStorage fallback path 廃止が決定済 (memory `project_localstorage_fallback_removal_2026_05_08.md`)。残骸が無いか確認する。

## 必須 step

### 1. store 一覧と responsibility 把握

```bash
ls frontend/src/store/*.ts | grep -v test | head -30
# 各 store の "load / save / set / clear" 公開 API を把握
grep -nE "^export (async )?function (load|save|set|clear|create|delete|update)" frontend/src/store/*.ts | head -50
```

### 2. localStorage 残骸 grep

```bash
# localStorage 直接アクセスを全 grep
grep -rn "localStorage\." frontend/src/ 2>&1 | grep -v "// removed\|@deprecated" | head -40
# fallback path 経路 (mcpBridge 切断時) が残っているか
grep -rnE "ws.*disconnect.*localStorage|fallback.*localStorage" frontend/src/ 2>&1 | head -20
```

### 3. dirty-check / autosave timing

```bash
# autosave debounce timer
grep -rnE "debounce|setTimeout.*save|autosave" frontend/src/store/ 2>&1 | head -30
# dirty flag setter
grep -rnE "setDirty|isDirty|markDirty" frontend/src/store/ 2>&1 | head -20
```

dirty を set するが clear しない (永続 dirty) / save 後に clear し忘れる 等の bug を探す。

### 4. mcpBridge との send/receive 整合

```bash
# wsBridge の対応 handler (backend) と一致するか
grep -nE "sendCommand|sendMessage" frontend/src/mcp/mcpBridge.ts | head -30
# backend 側 handler
grep -rnE "case \"\w+\":" backend/src/wsBridge.ts backend/src/handlers/*.ts | head -30
```

frontend が send する command と backend が受ける case の集合一致を assert (sabotage 風 grep)。

### 5. store load 経路の defensive default

```bash
# 旧 schema load 時の uuid fallback (I-7 で各 store に追加された)
grep -rnE "uuid\s*\?\?|uuid.*\|\|" frontend/src/store/ 2>&1 | head -20
# 必要なくなった defensive code の有無
```

### 6. dataDir / workspace switch 時の store reset

```bash
grep -rnE "loadWorkspaces|switchWorkspace|workspace.*reset" frontend/src/store/ 2>&1 | head -20
# 旧 workspace data が新 workspace に混ざる risk
```

### 7. test での fake timer 問題

過去 #1326 で `vi.useFakeTimers({ shouldAdvanceTime: true })` が debounce test で 25% flake していた。同パターンが他 store test に残っていないか:

```bash
grep -rnE "useFakeTimers\(\{[^}]*shouldAdvanceTime" frontend/src/store/ 2>&1
```

## 出力 format

findings.jsonl に append。

## classification 指針

- localStorage 直接アクセスの削除 (廃止済 path の残骸) → **auto-fix** (純粋削除なら) or **issue** (周辺ロジック調整伴うなら)
- dirty flag bug 修正 → **issue**
- autosave timer の調整 → **issue**
- workspace switch reset 漏れ修正 → **issue**
- test flake (fake timer pattern) 修正 → **issue** (test の堅牢化、レビュー要)
- store の JSDoc 追加 → **auto-fix**

## 完了判定

`frontend/src/store/` 配下の主要 store ファイル (10-15 個) を 1 巡し、findings.jsonl 0 件追加で `completed`。
