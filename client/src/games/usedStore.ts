/** Remembers which questions were already asked in this browser session (survives a TV refresh). */
export function usedSet(game: string): Set<string> {
  const key = `cp.used.${game}`;
  let initial: string[] = [];
  try {
    initial = JSON.parse(sessionStorage.getItem(key) ?? '[]');
  } catch {
    /* ignore */
  }
  const set = new Set<string>(initial);
  const save = () => {
    try {
      sessionStorage.setItem(key, JSON.stringify([...set]));
    } catch {
      /* ignore */
    }
  };
  const add = set.add.bind(set);
  const clear = set.clear.bind(set);
  set.add = (v: string) => {
    add(v);
    save();
    return set;
  };
  set.clear = () => {
    clear();
    save();
  };
  return set;
}
