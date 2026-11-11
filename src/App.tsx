import { useEffect, useState } from 'react';
import Trainer, { type TrainRequest } from './Trainer';
import Review from './Review';
import Drill from './Drill';
import { MISTAKES_CHANGED, dueMistakes } from './mistakes';
import './App.css';

type Screen = 'play' | 'review' | 'drill';

export default function App() {
  const [screen, setScreen] = useState<Screen>('play');
  const [trainRequest, setTrainRequest] = useState<TrainRequest | null>(null);
  const [due, setDue] = useState(() => dueMistakes().length);

  useEffect(() => {
    const refresh = () => setDue(dueMistakes().length);
    window.addEventListener(MISTAKES_CHANGED, refresh);
    const timer = setInterval(refresh, 60_000); // cards become due as time passes
    return () => {
      window.removeEventListener(MISTAKES_CHANGED, refresh);
      clearInterval(timer);
    };
  }, []);

  const tabs: { id: Screen; label: string; icon: string; badge?: number }[] = [
    { id: 'play', label: 'שחק', icon: '♟' },
    { id: 'review', label: 'הסקירה שלי', icon: '▦' },
    { id: 'drill', label: 'חזרה', icon: '↻', badge: due },
  ];

  return (
    <div className="app" dir="rtl">
      {/* top bar on desktop, bottom tab bar on phones (see App.css) */}
      <nav className="topbar">
        <h1 className="brand">
          <span className="brand-mark" aria-hidden>♞</span>
          מאמן שחמט
        </h1>
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === screen}
              className={t.id === screen ? 'tab active' : 'tab'}
              onClick={() => setScreen(t.id)}
            >
              <span className="tab-icon" aria-hidden>{t.icon}</span>
              <span className="tab-label">{t.label}</span>
              {!!t.badge && <span className="badge">{t.badge}</span>}
            </button>
          ))}
        </div>
      </nav>

      {/* Trainer and Review stay mounted so a game in progress / loaded games survive tab switches */}
      <div hidden={screen !== 'play'}>
        <Trainer trainRequest={trainRequest} active={screen === 'play'} />
      </div>
      <div hidden={screen !== 'review'}>
        <Review
          onTrain={(repertoireId) => {
            setTrainRequest({ repertoireId, nonce: Date.now() });
            setScreen('play');
          }}
          onDrill={() => setScreen('drill')}
        />
      </div>
      {screen === 'drill' && <Drill />}
    </div>
  );
}
