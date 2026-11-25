/** Telling whether the version live on the server is newer than the one this page runs. */

export interface BuildInfo {
  commit: string;
  builtAt: string;
}

/** True when the live version.json names a different build from `mine`. */
export function isNewer(live: { commit?: unknown; builtAt?: unknown }, mine: BuildInfo): boolean {
  if (typeof live.commit !== 'string' || !live.commit) return false;
  // Local builds without git all say "dev": compare build times instead.
  if (live.commit === 'dev' || mine.commit === 'dev') return live.builtAt !== mine.builtAt;
  return live.commit !== mine.commit;
}
