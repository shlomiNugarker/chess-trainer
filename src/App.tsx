import { useEffect, useState } from 'react';
import Trainer, { type TrainRequest } from './Trainer';
import Review from './Review';
import Practice, { type PracticeView } from './Practice';
import Learn from './Learn';
import { todaysMistakes, useMistakeCount } from './mistakes';
import { useStored, writeStored } from './storage';
import { LANGS, langName, dir, setLang, tr, useLang } from './i18n';
import Account from './Account';
import { useCloud } from './cloud';
import { REPERTOIRES } from './repertoire';
import { withCustom } from './customLines';
import { ENGINE_STATUS } from './engine';
import { go, goTo, useNav, type Screen } from './nav';
import './App.css';

const closeAccount = () => go({ account: false });
const dueCount = () => todaysMistakes().length;

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

  const [engineFailed, setEngineFailed] = useState(false);
  useEffect(() => {
    const onStatus = (e: Event) => setEngineFailed(!(e as CustomEvent<boolean>).detail);
    window.addEventListener(ENGINE_STATUS, onStatus);
    return () => window.removeEventListener(ENGINE_STATUS, onStatus);
  }, []);

  const tabs: { id: Screen; label: string; icon: string; badge?: number }[] = [
    { id: 'play', label: tr('Play'), icon: '♟' },
    { id: 'learn', label: tr('Learn'), icon: '📖' },
    { id: 'review', label: tr('My review'), icon: '▦' },
    { id: 'drill', label: tr('Practice'), icon: '🧩', badge: due },
  ];

  return (
    <div className="app" dir={dir()}>
      {/* top bar on desktop, bottom tab bar on phones (see App.css) */}
      <nav className="topbar">
        <h1 className="brand">
          <span className="brand-mark" aria-hidden>♞</span>
          {tr('Chess Trainer')}
        </h1>
        <div className="tabs">
          {/* the account / language button beside them is not a tab */}
          <div role="tablist" className="tabs-only">
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
          </div>
          {cloud.enabled ? (
            // account (Google sign-in, sync) and language, in one panel (a fifth item in the phone tab bar)
            <button className="tab lang-switch account-tab" onClick={() => go({ account: true })} aria-haspopup="dialog">
              <span className="tab-icon" aria-hidden>
                {cloud.user?.photo ? <img className="avatar avatar-sm" src={cloud.user.photo} alt="" referrerPolicy="no-referrer" /> : '👤'}
              </span>
              <span className="tab-label">{tr('Account')}</span>
            </button>
          ) : (
            // no cloud configured: the next language, always one tap away
            <button className="tab lang-switch" onClick={() => setLang(nextLang.id)} lang={nextLang.id}>
              <span className="tab-icon" aria-hidden>🌐</span>
              <span className="tab-label">{langName(nextLang.id)}</span>
            </button>
          )}
        </div>
      </nav>

      {engineFailed && (
        <div className="card engine-failed" role="alert">
          <span>{tr('The chess engine did not load. Check your internet connection and try again.')}</span>
          <button className="primary" onClick={() => location.reload()}>{tr('Try again')}</button>
        </div>
      )}

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
            writeStored('learn-repertoire', repertoireId);
            writeStored('learn-line', Math.max(0, rep.lines.findIndex((l) => l.moves === moves)));
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
