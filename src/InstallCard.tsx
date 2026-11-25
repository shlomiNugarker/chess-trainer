import { useCloud } from './cloud';
import { tr } from './i18n';
import { declineInstall, install, useDeclined, useInstall } from './install';

/** In Learn, once the app was really used: a suggestion to install it. "Not now" is for good. */
export function InstallCard() {
  const how = useInstall();
  const declined = useDeclined();
  if (!how || declined) return null;
  return (
    <div className="card install-card">
      <div className="install-text">
        <strong>{tr('Keep it one tap away')}</strong>
        <p className="muted">
          {how === 'ios' ? <IosSteps /> : tr('Install the app: it opens full screen from its own icon, and works offline.')}
        </p>
      </div>
      <div className="buttons">
        {how === 'prompt' && <button className="primary small" onClick={() => void install()}>{tr('Install')}</button>}
        <button className="ghost small" onClick={declineInstall}>{how === 'ios' ? tr('Got it') : tr('Not now')}</button>
      </div>
    </div>
  );
}

/** In the account panel: there for as long as the app can be installed. */
export function InstallRow() {
  const how = useInstall();
  if (!how) return null;
  return (
    <div className="account-row install-row">
      {how === 'ios' ? (
        <p className="muted"><IosSteps /></p>
      ) : (
        <>
          <span>{tr('App on this device')}</span>
          <button onClick={() => void install()}>{tr('Install the app')}</button>
        </>
      )}
    </div>
  );
}

/** The installed app may have a storage of its own there: the progress gets to it through the account. */
function IosSteps() {
  const cloud = useCloud();
  return (
    <>
      {tr('To install the app: tap Share, then "Add to Home Screen".')}
      {cloud.enabled && !cloud.user && <> {tr('Sign in first, and then in the installed app too, so your progress is there as well.')}</>}
    </>
  );
}
