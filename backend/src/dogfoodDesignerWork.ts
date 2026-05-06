/**
 * /designer-work 実地ドッグフード CLI (#261)
 *
 * 使い方:
 *   cd backend
 *   npx tsx src/dogfoodDesignerWork.ts <processFlowId>
 *
 * 動作:
 *   1. data/process-flows/<id>.json を読む
 *   2. markers を kind 別に処理 (todo=編集解決 / question=chat返信+resolve /
 *      attention=提案保留 / chat=返信+resolve)
 *   3. data/process-flows/<id>.json に書き戻す
 *   4. ws://localhost:5179 に接続し browser 役で saveProcessFlow を送信して broadcast 発火
 *      (これで開いている browser の ProcessFlowEditor が自動再描画される)
 *
 * 目的: MCP stdio がなくても dev env で /designer-work の挙動を再現し、
 *       ブラウザでリアルタイム反映を検証できるようにする。
 */
import path from "node:path";
import { readProcessFlow, writeProcessFlow } from "./projectStorage.js";
import {
  listMarkers,
  addMarker,
  resolveMarker,
  addCatalogEntry,
  type ProcessFlowDoc,
} from "./processFlowEdits.js";
import WebSocket from "ws";

async function broadcastSave(id: string, data: ProcessFlowDoc): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket("ws://localhost:5179");
    const clientId = `dogfood-${Date.now()}`;
    const reqId = `req-${Date.now()}`;
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "register", clientId }));
      setTimeout(() => {
        ws.send(JSON.stringify({ type: "request", id: reqId, method: "saveProcessFlow", params: { id, data } }));
      }, 100);
    });
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "response" && msg.id === reqId) {
        ws.close();
        resolve();
      }
    });
    ws.on("error", (e) => reject(e));
    setTimeout(() => { ws.close(); resolve(); /* WS 未起動でも helper 書換は成功とする */ }, 3000);
  });
}

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("使い方: tsx src/dogfoodDesignerWork.ts <processFlowId>");
    process.exit(1);
  }

  // root: env DESIGNER_DATA_DIR か、リポジトリルートの data/ をデフォルトとして使う
  const root = process.env.DESIGNER_DATA_DIR
    ? path.resolve(process.env.DESIGNER_DATA_DIR)
    : path.resolve(import.meta.dirname, "../../data");

  const ag = await readProcessFlow(id, root) as ProcessFlowDoc | null;
  if (!ag) {
    console.error(`ProcessFlow ${id} が見つかりません (data/process-flows/${id}.json)`);
    process.exit(1);
  }

  const markers = listMarkers(ag, { unresolvedOnly: true });
  console.log(`未解決マーカー: ${markers.length} 件`);

  let resolvedCount = 0;
  let aiRepliesAdded = 0;
  const catalogChanges: string[] = [];

  for (const m of markers) {
    const body = m.body;
    console.log(`  [${m.kind}] ${body.slice(0, 60)}${body.length > 60 ? "..." : ""}`);

    if (m.kind === "todo") {
      // 命令形チェックは本番の LLM が行う。ここではキーワードベースの簡易版。
      // 例: "errorCatalog に STOCK_SHORTAGE 409 を追加" → key=STOCK_SHORTAGE, 409
      const match = body.match(/errorCatalog\s*[にを]?\s*([A-Z][A-Z0-9_]{2,})\s*\(?(\d{3})\)?/);
      if (match && body.includes("追加")) {
        const key = match[1];
        const httpStatus = Number(match[2]);
        addCatalogEntry(ag, "errorCatalog", key, { httpStatus });
        catalogChanges.push(`errorCatalog.${key} (${httpStatus})`);
        resolveMarker(ag, m.id, `errorCatalog.${key} (httpStatus ${httpStatus}) を追加`);
        resolvedCount++;
        continue;
      }
      // その他 todo は保留
      resolveMarker(ag, m.id, "保留: body の指示を解析できませんでした");
      resolvedCount++;
    } else if (m.kind === "question") {
      addMarker(ag, {
        kind: "chat",
        body: "自動回答: 詳細分析が必要です。人間の判断で回答してください。",
        author: "ai",
        stepId: m.stepId,
      });
      aiRepliesAdded++;
      resolveMarker(ag, m.id, "chat 返信で応答");
      resolvedCount++;
    } else if (m.kind === "attention") {
      // committed 保護: attention では編集せず提案保留
      resolveMarker(ag, m.id, `提案 (実編集はせず保留): "${body.slice(0, 40)}..." を検討済み。承認待ち`);
      resolvedCount++;
    } else if (m.kind === "chat") {
      addMarker(ag, {
        kind: "chat",
        body: `自動応答: "${body.slice(0, 40)}..." を受信しました。`,
        author: "ai",
      });
      aiRepliesAdded++;
      resolveMarker(ag, m.id, "chat 返信で応答");
      resolvedCount++;
    }
  }

  ag.updatedAt = new Date().toISOString();
  await writeProcessFlow(id, ag, root);
  console.log(`ファイル書き戻し完了: ${root}/actions/${id}.json`);

  console.log("ws broadcast を試行...");
  await broadcastSave(id, ag);

  console.log("\n=== サマリ ===");
  console.log(`解決: ${resolvedCount} / AI 返信追加: ${aiRepliesAdded} / カタログ変更: ${catalogChanges.length}`);
  if (catalogChanges.length > 0) console.log("  追加:", catalogChanges.join(", "));
}

main().catch((e) => { console.error(e); process.exit(1); });
