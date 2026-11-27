// A link to one line of the repertoire (?line=<repertoire id>/<line id>), made by "Share this line" in Learn.
// Read once at startup, before nav.ts restores the last tab (main.tsx imports this module before App): the app opens
// on Learn, on that line, and the parameter leaves the address bar (others, such as lang or utm_*, stay).

import { REPERTOIRES } from './repertoire';
import { writeStored } from './storage';
import { hiddenIds, setHidden } from './hiddenReps';

/** The line a link asks for (lineIdx -1: no such line any more), and the query without it. */
export function sharedLineFromSearch(search: string): { repId: string; lineIdx: number; rest: string } | null {
  const q = new URLSearchParams(search);
  const asked = q.get('line');
  if (asked === null) return null;
  q.delete('line');
  const rest = q.toString() ? `?${q}` : '';
  const cut = asked.indexOf('/');
  const rep = REPERTOIRES.find((r) => r.id === asked.slice(0, cut));
  const lineIdx = rep ? rep.lines.findIndex((l) => l.id === asked.slice(cut + 1)) : -1;
  return rep && cut > 0 && lineIdx >= 0 ? { repId: rep.id, lineIdx, rest } : { repId: '', lineIdx: -1, rest };
}

/** The address of a line, for "Share this line". */
export const shareUrl = (repId: string, lineId: string) => `${location.origin}/?line=${encodeURIComponent(`${repId}/${lineId}`)}`;

function open(): boolean {
  if (typeof window === 'undefined') return false;
  const asked = sharedLineFromSearch(location.search);
  if (!asked) return false;
  history.replaceState(history.state, '', location.pathname + asked.rest + location.hash);
  if (asked.lineIdx < 0) return false; // a line that no longer exists: the app opens as usual
  writeStored('learn-repertoire', asked.repId);
  writeStored('learn-line', asked.lineIdx);
  writeStored('screen', 'learn');
  const hidden = hiddenIds();
  if (hidden.includes(asked.repId)) setHidden(hidden.filter((id) => id !== asked.repId)); // a hidden opening is shown again
  return true;
}

/** This visit came from a link to a line: Learn shows it at once, without the first question of which openings you play. */
export const openedFromLink = open();
