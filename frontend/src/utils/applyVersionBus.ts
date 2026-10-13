/**
 * 保存前の版 (上書きされる前の内容) を、開いている編集画面の編集状態へ読み込むための取り次ぎ。
 *
 * 履歴の画面 (DraftHistoryModal) は、どの編集画面の中にいるかを知らない。編集画面 (useResourceEditor) が、
 * 自分の種類・id に当たる要求を受け取って、編集状態を差し替える (保存するまで原本は変わらない)。
 * 編集セッションに編集者として入り直したとき (履歴からの復元・再開) に、そのセッションの内容を編集状態へ入れるのにも使う。
 */
export interface ApplyVersionRequest { resourceType: string; resourceId: string; snapshot: unknown }
type Listener = (req: ApplyVersionRequest) => boolean;

const listeners = new Set<Listener>();

export function onApplyVersion(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** 編集画面へ読み込みを頼む。受け取った画面があれば true */
export function requestApplyVersion(req: ApplyVersionRequest): boolean {
  let taken = false;
  for (const fn of [...listeners]) if (fn(req)) taken = true;
  return taken;
}

/**
 * 編集画面が受け取れるようになるまで (画面の反映のあとで受け取りを登録する)、短い間隔で頼み直す。
 * 受け取られたら true、時間切れなら onGiveUp を呼ぶ。
 */
export function requestApplyVersionWhenReady(req: ApplyVersionRequest, onGiveUp?: () => void, intervalMs = 50, tries = 40): void {
  let n = 0;
  const tick = () => {
    if (requestApplyVersion(req)) return;
    if (++n >= tries) { onGiveUp?.(); return; }
    setTimeout(tick, intervalMs);
  };
  setTimeout(tick, 0);
}
