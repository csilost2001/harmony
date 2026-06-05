/** Current effective EditSession cleanup defaults.
 *
 * These are runtime constants, not the final configuration surface. Keep UI
 * copy and backend cleanup on this single source until harmony.json-backed
 * retention settings are wired end to end.
 */
export const EDIT_SESSION_TTL_DAYS = 2;
export const EDIT_SESSION_DISCARDED_RETENTION_DAYS = 7;
export const DRAFT_HISTORY_RETENTION_DAYS = 7;
