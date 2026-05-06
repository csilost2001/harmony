/**
 * 描画マーカーの DOM アンカリング (#261)。
 *
 * 描画ストロークが特定の step 要素 / field 要素の上で行われた場合、
 * その要素の id (step.id / fieldPath) を保存して、ストローク座標を
 * その要素の bounding box に対する % に変換する。これにより:
 *
 * - MarkerPanel の折畳/展開、step 並び替え、前後への step 挿入で
 *   描画の視覚位置が step 要素と一緒に動く (ずれない)
 * - step 削除時は orphan として扱える (該当なし表示)
 *
 * この file は副作用のない純粋関数のみ置き、DOM 依存部分は最小限。
 * 呼び出し側が DOMRect を取得して渡す前提 (テスト容易性のため)。
 */

export interface Point { x: number; y: number }
export interface Rect { left: number; top: number; width: number; height: number }

/**
 * SVG path の `d` 属性文字列から `M x y` / `L x y` の座標を抽出する。
 * 他のコマンド (C / Z 等) は現状未使用だが、将来拡張する場合は
 * ここを拡張する。
 */
export function parsePathPoints(d: string): Point[] {
  const points: Point[] = [];
  const re = /([ML])\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    points.push({ x: parseFloat(m[2]), y: parseFloat(m[3]) });
  }
  return points;
}

/** 点群の bounding box. 空配列なら null */
export function computeBBox(points: Point[]): { min: Point; max: Point; center: Point } | null {
  if (points.length === 0) return null;
  let minX = points[0].x, maxX = points[0].x;
  let minY = points[0].y, maxY = points[0].y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    min: { x: minX, y: minY },
    max: { x: maxX, y: maxY },
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  };
}

/**
 * path `d` 内の座標を viewBox 空間 (overlay の 0-100) から
 * anchor rect の 0-100 % に変換する。
 *
 * @param d  元の path 文字列 (overlay viewBox 0-100 相対)
 * @param overlay  overlay 全体の viewport rect
 * @param anchor  anchor 要素の viewport rect
 */
export function convertPathToAnchorRelative(
  d: string,
  overlay: Rect,
  anchor: Rect,
): string {
  if (anchor.width <= 0 || anchor.height <= 0) return d;
  return d.replace(
    /([ML])\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g,
    (_match, cmd, xStr, yStr) => {
      const pctX = parseFloat(xStr);
      const pctY = parseFloat(yStr);
      // overlay % → viewport px
      const vpX = overlay.left + (pctX / 100) * overlay.width;
      const vpY = overlay.top + (pctY / 100) * overlay.height;
      // viewport px → anchor %
      const aX = ((vpX - anchor.left) / anchor.width) * 100;
      const aY = ((vpY - anchor.top) / anchor.height) * 100;
      return `${cmd} ${aX.toFixed(2)} ${aY.toFixed(2)}`;
    },
  );
}

/**
 * 描画ストロークの中点 (bbox 中央) を overlay viewBox 空間 (0-100) から
 * viewport px に変換。後続の elementFromPoint などに使う。
 */
export function strokesCenterInViewport(
  strokeDs: string[],
  overlay: Rect,
): Point | null {
  const allPoints: Point[] = [];
  for (const d of strokeDs) {
    for (const p of parsePathPoints(d)) allPoints.push(p);
  }
  const bb = computeBBox(allPoints);
  if (!bb) return null;
  return {
    x: overlay.left + (bb.center.x / 100) * overlay.width,
    y: overlay.top + (bb.center.y / 100) * overlay.height,
  };
}
