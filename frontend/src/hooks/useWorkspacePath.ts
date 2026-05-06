/**
 * useWorkspacePath — /w/:wsId/* 規約のパス生成ユーティリティ
 *
 * react-router v7 では useParams() が祖先 Route のパラメータも返す。
 * /w/:wsId/* 配下でマウントされたコンポーネントは wsId を取得できる。
 *
 * 使い方:
 *   const { wsPath } = useWorkspacePath();
 *   navigate(wsPath("/screen/list"));
 *   // → /w/<active-wsId>/screen/list
 */

import { useCallback } from "react";
import { useParams } from "react-router-dom";

interface UseWorkspacePathResult {
  /** /w/:wsId/<suffix> を返す。wsId が取れない場合は <suffix> のまま返す */
  wsPath: (suffix: string) => string;
  /** 現在の wsId (未定の場合は undefined) */
  wsId: string | undefined;
}

export function useWorkspacePath(): UseWorkspacePathResult {
  const { wsId } = useParams<{ wsId: string }>();

  // wsId が同じである限り wsPath の関数 ref を安定化する。
  // これを useCallback しないと、本フックを使うコンポーネントで
  // wsPath を deps に持つ useMemo / useCallback / useEffect が
  // 毎レンダー再評価され、setState 系を内側で叩いていると
  // 無限ループ ("Maximum update depth exceeded") を起こす
  // (UnsavedDraftsPanel で実際に発生していた、2026-05-04 修正)。
  const wsPath = useCallback((suffix: string): string => {
    if (!wsId) return suffix;
    const normalizedSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`;
    return `/w/${wsId}${normalizedSuffix}`;
  }, [wsId]);

  return { wsPath, wsId };
}
