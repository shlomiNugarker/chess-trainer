import { useRef } from 'react';
import { useDialog } from './useDialog';
import { msg, tr } from './i18n';

const ISSUES = 'https://github.com/shlomiNugarker/chess-trainer/issues';

/** What the app keeps and where: opened from the account panel, or at /privacy (src/nav.ts). */
export default function Privacy({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useDialog(panel, true, onClose);

  return (
    <>
      <div className="account-backdrop" onClick={onClose} />
      <div ref={panel} className="account-panel privacy-panel card" role="dialog" aria-modal="true" aria-label={tr('Privacy')}>
        <div className="sheet-handle" aria-hidden />
        <div className="account-head">
          <h2>{tr('Privacy')}</h2>
          <button className="ghost icon-btn" onClick={onClose} aria-label={tr('Close')}>✕</button>
        </div>
        <div className="privacy-body">
          <p>{tr('Chess Trainer needs no account and shows no ads. This is everything it keeps, and where.')}</p>

          <h3>{tr('Without signing in')}</h3>
          <p>{tr('Your progress (lines, puzzles, rating, mistakes and settings, with the Chess.com username you typed) is kept in this browser, on this device. It is not sent anywhere, except as described below.')}</p>

          <h3>{tr('With Google sign-in')}</h3>
          <p>
            {tr('Only to keep your devices in sync, your progress is stored in Google Firebase (Cloud Firestore) under your Google user id, in users/{uid}, which only you can read. To sign you in, Firebase Authentication keeps your Google account (name, email and the link to your profile picture); the picture is loaded from Google to show it in the app. Nothing is shared with anyone. Without signing in, nothing is sent to Firebase.')}
          </p>

          <h3>Chess.com</h3>
          <p>{tr('When you load your games, the username you type is sent to the public Chess.com API to get your public games. They are analyzed in your browser.')}</p>

          <h3>{tr('Usage counts')}</h3>
          <p>{tr('We count page views with Vercel Web Analytics: anonymous, without cookies, and not across other sites. Everything else the app needs (the font, the chess engine, the puzzles) comes from this site, so there is no other tracking.')}</p>

          <h3>{tr('Deleting your data')}</h3>
          <p>
            {tr(msg`On a device: sign out, then clear this site’s data in the browser settings. In the cloud: in the account panel, “${tr('Delete my cloud data')}” deletes your progress in the cloud and your sign-in to this app.`)}
          </p>
          <p>
            <a href={ISSUES} target="_blank" rel="noreferrer">{tr('For anything else, write to us in a GitHub issue.')}</a>
          </p>
          <p className="muted">{tr('Last updated: November 2026')}</p>
        </div>
      </div>
    </>
  );
}
