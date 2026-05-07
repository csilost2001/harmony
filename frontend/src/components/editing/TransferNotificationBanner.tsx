/**
 * TransferNotificationBanner.tsx (#902 Phase 5)
 *
 * editSession.roleChanged (op: "transferred") を受信して、
 * 元 owner / 新 owner に通知バナーを表示する。
 * docs/spec/edit-session-protocol.md §14.1 に準拠。
 *
 * - 自分が from (= 元 owner、Edit → View): 「@bob が編集を引き継ぎました」
 * - 自分が to (= 新 owner、View → Edit): 「@alice から編集を引き継ぎました」
 *
 * 後方互換: lock.changed op:"transferred" も引き続き受け取る (Phase 6 で削除予定)
 * autoclose: 5s
 */
import { useEffect, useState, useCallback } from "react";
import { mcpBridge } from "../../mcp/mcpBridge";
import type { DraftResourceType } from "../../types/draft";

export interface TransferNotificationBannerProps {
  /** このコンポーネントを表示するリソース (null = 全リソース対象) */
  resourceType?: DraftResourceType;
  resourceId?: string;
  /** 現在のセッション ID */
  clientId: string;
}

interface BannerState {
  message: string;
  kind: "taken-from-me" | "taken-by-me";
}

const AUTO_CLOSE_MS = 5000;

export function TransferNotificationBanner({
  resourceType,
  resourceId,
  clientId,
}: TransferNotificationBannerProps) {
  const [banner, setBanner] = useState<BannerState | null>(null);

  const dismiss = useCallback(() => setBanner(null), []);

  // 新 API: editSession.roleChanged (spec §14.1)
  useEffect(() => {
    const unsub = mcpBridge.onBroadcast("editSession.roleChanged", (data) => {
      const d = data as {
        editSessionId: string;
        sessionId: string;
        oldRole: string;
        newRole: "Edit" | "View";
        op?: string;
        // transferEdit 時は fromSessionId / toSessionId が含まれる
        fromSessionId?: string;
        toSessionId?: string;
        // displayLabel 系 (optional)
        fromLabel?: string;
        toLabel?: string;
      };

      // op が transferred でない場合は無視
      if (d.op !== "transferred") return;

      const from = d.fromSessionId ?? "";
      const to = d.toSessionId ?? d.sessionId ?? "";
      const fromLabel = d.fromLabel ?? from.slice(0, 8);
      const toLabel = d.toLabel ?? to.slice(0, 8);

      if (from === clientId) {
        // 自分が引き継がれた側 (元 owner)
        setBanner({
          message: `@${toLabel} が編集を引き継ぎました`,
          kind: "taken-from-me",
        });
      } else if (to === clientId) {
        // 自分が引き継いだ側 (新 owner)
        setBanner({
          message: `@${fromLabel} から編集を引き継ぎました`,
          kind: "taken-by-me",
        });
      }
    });

    return unsub;
  }, [resourceType, resourceId, clientId]);

  // 後方互換: lock.changed op:"transferred" (Phase 6 で削除予定)
  useEffect(() => {
    const unsub = mcpBridge.onBroadcast("lock.changed", (data) => {
      const d = data as {
        resourceType: string;
        resourceId: string;
        op: string;
        ownerSessionId?: string;
        by?: string;
        previousOwner?: string;
      };

      if (d.op !== "transferred") return;

      // リソースフィルタ (指定がある場合のみ絞り込む)
      if (resourceType && d.resourceType !== resourceType) return;
      if (resourceId && d.resourceId !== resourceId) return;

      const previousOwner = d.previousOwner ?? "";
      const newOwner = d.ownerSessionId ?? d.by ?? "";

      if (previousOwner === clientId) {
        setBanner({
          message: `あなたの draft は @${newOwner.slice(0, 8)} に引き継がれました`,
          kind: "taken-from-me",
        });
      } else if (newOwner === clientId) {
        setBanner({
          message: `@${previousOwner.slice(0, 8)} さんの draft を引継ぎました`,
          kind: "taken-by-me",
        });
      }
    });

    return unsub;
  }, [resourceType, resourceId, clientId]);

  // autoclose 5s
  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [banner]);

  if (!banner) return null;

  return (
    <div
      className={`transfer-notification-banner alert ${
        banner.kind === "taken-from-me" ? "alert-warning" : "alert-info"
      } d-flex align-items-center gap-2 py-2 px-3`}
      role="alert"
      data-testid="transfer-notification-banner"
    >
      <span>{banner.kind === "taken-from-me" ? "↗" : "↙"}</span>
      <span className="flex-grow-1">{banner.message}</span>
      <button
        type="button"
        className="btn-close btn-sm"
        aria-label="閉じる"
        onClick={dismiss}
        data-testid="transfer-notification-dismiss"
      />
    </div>
  );
}
