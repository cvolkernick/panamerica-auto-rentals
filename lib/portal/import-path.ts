/** Import id from /admin/imports/<id>. The static shell is /admin/imports/. */
export function importIdFromPath(pathname: string): number | null {
  const trimmed = pathname.replace(/\/+$/, "");
  const match = /^\/admin\/imports\/([1-9]\d*)$/.exec(trimmed);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

export function importReviewHref(id: number): string {
  return `/admin/imports/${id}/`;
}
