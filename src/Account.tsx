import { useEffect, useRef, useState } from 'react';
import { useDialog } from './useDialog';
import { deleteCloudData, preloadCloud, signIn, signOut, useCloud } from './cloud';
import { go } from './nav';
import { InstallRow } from './InstallCard';
import { explanationsNote } from './repertoire';
import { LANGS, hasExplanations, langName, locale, setLang, msg, tr, useLang } from './i18n';

/** The account panel: Google sign-in (to keep progress in sync between devices) and the language. */
export default function Account({ onClose }: { onClose: () => void }) {
  const cloud = useCloud();
  const lang = useLang();
  const title = cloud.enabled ? tr('Account') : tr('Settings');

  useEffect(preloadCloud, []);

  const [askDelete, setAskDelete] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useDialog(panel, !askDelete, onClose); // while the question is open, Escape and Tab belong to it

  const time = cloud.lastSync ? new Date(cloud.lastSync).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : '';
  const statusText = {
    idle: '',
    'signing-in': tr('Signing in…'),
    syncing: tr('Syncing…'),
    synced: time ? tr(msg`Synced ✓ · ${time}`) : tr('Synced ✓'),
    offline: tr('Offline — will sync when you are back online'),
    error: tr('Sync failed — will try again soon'),
    'too-big': tr('There is too much data to sync, so it is kept on this device only'),
    'no-room': tr('No room on this device to keep the previous account’s data, so this account is not syncing'),
    deleting: tr('Deleting your cloud data…'),
    'delete-failed': tr('Deleting did not work. Please try again.'),
    deleted: '',
    'deleted-elsewhere': '',
  }[cloud.status];
  const deleted = {
    deleted: tr('Your cloud data and your account here were deleted. Your progress on this device stays.'),
    'deleted-elsewhere': tr('This account’s cloud data was deleted on another device, so this device signed out. Your progress here stays.'),
  }[cloud.status as 'deleted' | 'deleted-elsewhere'];

  return (
    <>
      <div className="account-backdrop" onClick={onClose} />
      <div ref={panel} className="account-panel card" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-handle" aria-hidden />
        <div className="account-head">
          <h2>{title}</h2>
          <button className="ghost icon-btn" onClick={onClose} aria-label={tr('Close')}>✕</button>
        </div>

        {cloud.enabled &&
          (cloud.user ? (
            <div className="account-user">
              {cloud.user.photo ? (
                <img className="avatar" src={cloud.user.photo} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="avatar avatar-letter" aria-hidden>{(cloud.user.name || cloud.user.email || '?')[0]}</span>
              )}
              <div className="account-who">
                <strong>{cloud.user.name || cloud.user.email}</strong>
                {cloud.user.name && <span className="muted">{cloud.user.email}</span>}
                <span className={['error', 'offline', 'too-big', 'no-room', 'delete-failed'].includes(cloud.status) ? 'sync-status warn' : 'sync-status'}>{statusText}</span>
              </div>
              <button className="ghost" onClick={() => void signOut()} disabled={cloud.status === 'deleting'}>{tr('Sign out')}</button>
              <button className="link delete-data" onClick={() => setAskDelete(true)} disabled={cloud.status === 'deleting'}>
                {tr('Delete my cloud data')}
              </button>
            </div>
          ) : (
            <div className="account-signin">
              <button className="google-btn" onClick={() => void signIn()} disabled={cloud.status === 'signing-in'}>
                <GoogleMark />
                {cloud.status === 'signing-in' ? tr('Signing in…') : tr('Sign in with Google')}
              </button>
              <p className="muted">
                {tr('Your progress (lines, puzzles, rating, mistakes and streak) syncs between phone and computer, and is kept even if the browser is cleared.')}
              </p>
              {cloud.status === 'error' && <p className="sync-status warn">{tr('Sign-in did not work. Please try again.')}</p>}
              {deleted && <p className="sync-status deleted-note" role="status">{deleted}</p>}
            </div>
          ))}

        <div className="account-row">
          <span>{tr('Language')}</span>
          <div className="chips">
            {LANGS.map((l) => (
              <button key={l.id} className={l.id === lang ? 'chip active' : 'chip'} aria-pressed={l.id === lang} onClick={() => setLang(l.id)} lang={l.id}>{langName(l.id)}</button>
            ))}
          </div>
        </div>
        {!hasExplanations() && <p className="muted lang-note">{explanationsNote()}</p>}
        <InstallRow />

        {/* GPL: whoever gets the app (and the Stockfish engine in it) can get the source */}
        <p className="muted account-foot">
          <button className="link" onClick={() => go({ privacy: true })}>{tr('Privacy')}</button> ·{' '}
          {tr('Open source (GPL-3.0)')} ·{' '}
          <a href="https://github.com/shlomiNugarker/chess-trainer" target="_blank" rel="noreferrer">GitHub</a> ·{' '}
          <a href="https://github.com/shlomiNugarker/chess-trainer/blob/main/THIRD_PARTY_NOTICES.md" target="_blank" rel="noreferrer">
            {tr('Licenses')}
          </a>
        </p>
      </div>
      {askDelete && (
        <DeleteQuestion
          onCancel={() => setAskDelete(false)}
          onDelete={() => {
            setAskDelete(false);
            void deleteCloudData();
          }}
        />
      )}
    </>
  );
}

/** "Delete my cloud data?" — asked in a dialog of its own, above the account panel. */
function DeleteQuestion({ onCancel, onDelete }: { onCancel: () => void; onDelete: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDialog(box, true, onCancel);
  return (
    <>
      <div className="account-backdrop confirm-backdrop" onClick={onCancel} />
      <div ref={box} className="confirm-dialog card" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-text">
        <h2 id="delete-title">{tr('Delete your cloud data?')}</h2>
        <p id="delete-text">
          {tr('This deletes your synced progress from the cloud and your sign-in to this app. It cannot be undone.')}{' '}
          {tr('Progress on this device stays, unless you also clear this site’s data in the browser.')}
        </p>
        <div className="buttons">
          <button className="ghost" onClick={onCancel}>{tr('Cancel')}</button>
          <button className="danger" onClick={onDelete}>{tr('Delete')}</button>
        </div>
      </div>
    </>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.6 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
