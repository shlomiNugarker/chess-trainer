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

  const tabs: { id: Screen; label: string }[] = [
    { id: 'play', label: 'שחק' },
    { id: 'review', label: 'הסקירה שלי' },
    { id: 'drill', label: due ? `חזרה (${due})` : 'חזרה' },
  ];

  return (
    <div className="app" dir="rtl">
      <nav className="tabs">
        <h1>מאמן שחמט</h1>
        {tabs.map((t) => (
          <button key={t.id} className={t.id === screen ? 'tab active' : 'tab'} onClick={() => setScreen(t.id)}>
            {t.label}
          </button>
        ))}
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
