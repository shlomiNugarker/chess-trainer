import { useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import type { GameSummary } from './chesscom';
import { Engine } from './engine';
import { REPERTOIRES, repName } from './repertoire';
import { addCustomLine, withCustom } from './customLines';
import { findDeviations, movesText, type OpponentDeviation, type UserDeviation } from './deviations';
import { saveMistake } from './mistakes';
import { ltr } from './chessUtils';
import { msg, tr, useLang } from './i18n';

const SHOW = 5;
const ANSWER_PLIES = 5; // the answer, then two more moves for each side
const gamesLabel = (n: number) => (n === 1 ? tr('משחק אחד', '1 game') : tr(`${n} משחקים`, msg`${n} games`));

/**
 * "Where your games leave your lines": opponent moves the repertoire doesn't answer (add Stockfish's answer as a
 * branch), and places where you played something else than the line (practice them in "My mistakes").
 */
export default function Branches({
  games,
  onLearn,
  onDrill,
}: {
  games: GameSummary[];
  onLearn: (repId: string, moves: string) => void;
  onDrill: () => void;
}) {
  useLang();
  const [version, setVersion] = useState(0); // bumps after a branch is added, so it leaves the list
  const reps = useMemo(() => REPERTOIRES.map(withCustom), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const dv = useMemo(() => findDeviations(games, reps), [games, reps]);
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<{ repId: string; moves: string; answer: string }[]>([]);
  const [drilled, setDrilled] = useState<Set<string>>(() => new Set());
  const [failed, setFailed] = useState(false);

  if (!dv.opp.length && !dv.mine.length && !added.length) return null;
  const rep = (id: string) => REPERTOIRES.find((r) => r.id === id)!;

  const addBranch = async (d: OpponentDeviation) => {
    const key = d.prefix.join(' ');
    setBusy(key);
    setFailed(false);
    const engine = new Engine();
    try {
      const c = new Chess();
      for (const s of d.prefix) c.move(s);
      const a = await engine.analyze(c.fen(), 'depth 16');
      const answer: string[] = [];
      for (const u of a.pv.slice(0, ANSWER_PLIES)) {
        try {
          answer.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
        } catch {
          break;
        }
      }
      if (!answer.length) throw new Error('no move');
      const moves = [...d.prefix, ...answer];
      addCustomLine(d.repId, moves, d.label);
      const shown = movesText(moves).split(' ').slice(-answer.length).join(' ');
      setAdded((x) => [...x, { repId: d.repId, moves: moves.join(' '), answer: shown }]);
      setVersion((v) => v + 1);
    } catch {
      setFailed(true);
    } finally {
      engine.terminate();
      setBusy(null);
    }
  };

  const practice = (d: UserDeviation) => {
    saveMistake({ fen: d.fen, played: d.played, correct: d.expected[0], source: 'book', repertoire: d.repId, gameUrl: d.lastUrl });
    setDrilled((s) => new Set(s).add(`${d.repId}|${d.fen}|${d.played}`));
  };

  return (
    <section className="card branches-card">
      <h2>{tr('איפה המשחקים שלך יוצאים מהקווים', 'Where your games leave your lines')}</h2>
      <p className="muted">
        {tr(
          'מתוך המשחקים בפתיחות שברפרטואר שלך: מהלכים של יריבים שאין להם מענה בקווים, ומקומות שבהם אתה יצאת מהקו.',
          'From your games in the repertoire openings: opponent moves your lines don’t answer, and places where you left the line yourself.',
        )}
      </p>

      {added.length > 0 && (
        <ul className="branch-list">
          {added.map((x) => (
            <li key={x.moves} className="branch-added">
              <span>
                ✓ {tr('נוסף ענף', 'Branch added')} · {repName(rep(x.repId))}: <span dir="ltr">{ltr(x.answer)}</span>
              </span>
              <button className="small" onClick={() => onLearn(x.repId, x.moves)}>{tr('ללמוד אותו ›', 'Learn it ›')}</button>
            </li>
          ))}
        </ul>
      )}

      {dv.opp.length > 0 && (
        <>
          <h3>{tr('יריבים שיחקו מהלך שאין לך עליו קו', 'Opponents played a move you have no line for')}</h3>
          <ul className="branch-list">
            {dv.opp.slice(0, SHOW).map((d) => {
              const key = d.prefix.join(' ');
              return (
                <li key={key}>
                  <span>
                    <b>{repName(rep(d.repId))}</b> · <span dir="ltr">{ltr(movesText(d.prefix))}</span>{' '}
                    <span className="muted">· {gamesLabel(d.count)}</span>
                  </span>
                  <button className="small primary" onClick={() => addBranch(d)} disabled={busy !== null}>
                    {busy === key ? tr('Stockfish חושב…', 'Stockfish is thinking…') : tr('הוסף ענף', 'Add a branch')}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="muted small-print">
            {tr(
              '"הוסף ענף" מוסיף לרפרטואר את התשובה של Stockfish ועוד שני מהלכים לכל צד. הענף יופיע בעמוד "למד" ובאימון.',
              '"Add a branch" adds Stockfish’s answer and two more moves for each side to your repertoire. It shows up in Learn and in training.',
            )}
          </p>
          {failed && <p className="sync-status warn">{tr('המנוע לא הצליח לנתח את העמדה. נסה שוב.', 'The engine could not analyze the position. Try again.')}</p>}
        </>
      )}

      {dv.mine.length > 0 && (
        <>
          <h3>{tr('כאן אתה יצאת מהקו', 'Here you left the line')}</h3>
          <ul className="branch-list">
            {dv.mine.slice(0, SHOW).map((d) => {
              const key = `${d.repId}|${d.fen}|${d.played}`;
              const done = drilled.has(key);
              return (
                <li key={key}>
                  <span>
                    <b>{repName(rep(d.repId))}</b> · <span dir="ltr">{ltr(movesText(d.prefix))}</span> —{' '}
                    {tr(`שיחקת ${ltr(d.played)} במקום ${ltr(d.label)}`, msg`you played ${d.played} instead of ${d.label}`)}{' '}
                    <span className="muted">· {gamesLabel(d.count)}</span>
                  </span>
                  {done ? (
                    <button className="small" onClick={onDrill}>{tr('נוסף לחזרה ›', 'Added — practice ›')}</button>
                  ) : (
                    <button className="small primary" onClick={() => practice(d)}>{tr('תרגל', 'Practice')}</button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
