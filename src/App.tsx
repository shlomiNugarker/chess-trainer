import { useEffect, useState } from 'react';
import Trainer, { type TrainRequest } from './Trainer';
import Review from './Review';
import Practice, { type PracticeView } from './Practice';
import Learn from './Learn';
import { dueMistakes, useMistakeCount } from './mistakes';
import { useStored } from './storage';
import { LANGS, dir, setLang, tr, useLang } from './i18n';
import Account from './Account';
import { useCloud } from './cloud';
import { REPERTOIRES } from './repertoire';
import { withCustom } from './customLines';
import { go, goTo, useNav, type Screen } from './nav';
import './App.css';

const closeAccount = () => go({ account: false });
const dueCount = () => dueMistakes().length;

export default function App() {
  const { screen, account: accountOpen } = useNav();
  const [, saveScreen] = useStored<Screen>('screen', 'learn');
  useEffect(() => saveScreen(screen), [screen, saveScreen]);
  const [trainRequest, setTrainRequest] = useState<TrainRequest | null>(null);
  const [practiceView, setPracticeView] = useStored<PracticeView>('practice-view', 'puzzles');
  /** Opens the Practice tab on puzzles or on the review of your mistakes. */
  const openPractice = (v: PracticeView) => {
    setPracticeView(v);
    goTo('drill');
  };
  const due = useMistakeCount(dueCount);
  const lang = useLang(); // re-renders the whole app when the language changes
  const nextLang = LANGS[(LANGS.findIndex((l) => l.id === lang) + 1) % LANGS.length];
  const cloud = useCloud();

  const tabs: { id: Screen; label: string; icon: string; badge?: number }[] = [
    { id: 'play', label: tr('שחק', 'Play'), icon: '♟' },
    { id: 'learn', label: tr('למד', 'Learn'), icon: '📖' },
    { id: 'review', label: tr('הסקירה שלי', 'My review'), icon: '▦' },
    { id: 'drill', label: tr('תרגול', 'Practice'), icon: '🧩', badge: due },
  ];

  return (
    <div className="app" dir={dir()}>
      {/* top bar on desktop, bottom tab bar on phones (see App.css) */}
      <nav className="topbar">
        <h1 className="brand">
          <span className="brand-mark" aria-hidden>♞</span>
          {tr('מאמן שחמט', 'Chess Trainer')}
        </h1>
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === screen}
              className={t.id === screen ? 'tab active' : 'tab'}
              onClick={() => goTo(t.id)}
            >
              <span className="tab-icon" aria-hidden>{t.icon}</span>
              <span className="tab-label">{t.label}</span>
              {!!t.badge && <span className="badge">{t.badge}</span>}
            </button>
          ))}
          {cloud.enabled ? (
            // account (Google sign-in, sync) and language, in one panel (a fifth item in the phone tab bar)
            <button className="tab lang-switch account-tab" onClick={() => go({ account: true })} aria-haspopup="dialog">
              <span className="tab-icon" aria-hidden>
                {cloud.user?.photo ? <img className="avatar avatar-sm" src={cloud.user.photo} alt="" referrerPolicy="no-referrer" /> : '👤'}
              </span>
              <span className="tab-label">{tr('חשבון', 'Account')}</span>
            </button>
          ) : (
            // no cloud configured: the next language, always one tap away
            <button className="tab lang-switch" onClick={() => setLang(nextLang.id)} lang={nextLang.id}>
              <span className="tab-icon" aria-hidden>🌐</span>
              <span className="tab-label">{nextLang.name}</span>
            </button>
          )}
        </div>
      </nav>

      {/* Trainer and Review stay mounted so a game in progress / loaded games survive tab switches */}
      <div hidden={screen !== 'play'}>
        <Trainer trainRequest={trainRequest} active={screen === 'play'} />
      </div>
      <div hidden={screen !== 'review'}>
        <Review
          active={screen === 'review'}
          onTrain={(repertoireId) => {
            setTrainRequest({ repertoireId, nonce: Date.now() });
            goTo('play');
          }}
          onDrill={() => openPractice('mistakes')}
          onLearn={(repertoireId, moves) => {
            // open Learn on that repertoire and line (Learn reads both when it mounts)
            const rep = withCustom(REPERTOIRES.find((r) => r.id === repertoireId)!);
            localStorage.setItem('chess-trainer:learn-repertoire', JSON.stringify(repertoireId));
            localStorage.setItem('chess-trainer:learn-line', JSON.stringify(Math.max(0, rep.lines.findIndex((l) => l.moves === moves))));
            goTo('learn');
          }}
        />
      </div>
      {screen === 'learn' && (
        <Learn
          onTrain={(repertoireId) => {
            setTrainRequest({ repertoireId, nonce: Date.now() });
            goTo('play');
          }}
          onDrill={() => openPractice('mistakes')}
          onPuzzles={() => openPractice('puzzles')}
        />
      )}
      {screen === 'drill' && <Practice view={practiceView} onView={setPracticeView} due={due} />}
      {accountOpen && <Account onClose={closeAccount} />}
    </div>
  );
}
