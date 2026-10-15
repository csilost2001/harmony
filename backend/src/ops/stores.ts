import { emptyAccess, emptyApprovals, emptyDocTemplate, emptyGeneration, emptyNotify, emptyReviewComments, parseAccess, parseApprovals, parseDocTemplate, parseGeneration, parseNotify, parseReviewComments } from "@harmony/shared";
import { makeOpsStore } from "./opsFiles.js";

/** 設計書の体裁と改訂履歴 (チームで共有) */
export const templateStore = makeOpsStore({ file: "document-template.json", scope: "data", parse: (raw) => { const r = parseDocTemplate(raw); return { value: r.template, problems: r.problems }; }, empty: emptyDocTemplate });
export const approvalsStore = makeOpsStore({ file: "approvals.json", scope: "data", parse: parseApprovals, empty: emptyApprovals });
export const commentsStore = makeOpsStore({ file: "review-comments.json", scope: "data", parse: parseReviewComments, empty: emptyReviewComments });
export const accessStore = makeOpsStore({ file: "access.json", scope: "data", parse: parseAccess, empty: emptyAccess });
export const generationStore = makeOpsStore({ file: "generation.json", scope: "data", parse: parseGeneration, empty: emptyGeneration });
/** 通知先 (URL は秘密。git に載せない) */
export const notifyStore = makeOpsStore({ file: "notify.json", scope: "hidden", parse: parseNotify, empty: emptyNotify });
