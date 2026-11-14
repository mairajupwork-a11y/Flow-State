import { useState } from 'react';
import { Icon } from './Icon';
import { promptInstall, useInstall } from '../lib/install';

const STEPS = {
  ios: 'In Safari, tap Share, then “Add to Home Screen”.',
  manual: 'Use your browser menu: “Install WorkMars” or “Add to Home Screen”.',
};

/** Settings card: install WorkMars as an app on this device. */
export function InstallCard() {
  const state = useInstall();
  const [help, setHelp] = useState(false);
  return (
    <div className="content-card install-card">
      <h3><Icon name="phone" size={16} /> WorkMars app</h3>
      <p className="muted">Install WorkMars on your phone, tablet or computer. It opens in its own window, starts from your home screen or dock, and gets push notifications.</p>
      <div className="setting-row">
        <div>
          <strong>{state === 'installed' ? 'Installed on this device' : 'Install on this device'}</strong>
          <small>{state === 'installed' ? 'You’re using the WorkMars app.' : state === 'prompt' ? 'One tap, no app store needed.' : help ? STEPS[state] : 'No app store needed.'}</small>
        </div>
        {state === 'installed' ? <Icon name="checkcircle" size={19} />
          : state === 'prompt' ? <button className="btn btn-primary btn-sm" onClick={() => void promptInstall()}><Icon name="download" size={14} /> Install</button>
          : <button className="btn btn-light btn-sm" onClick={() => setHelp(true)}><Icon name="download" size={14} /> How to install</button>}
      </div>
    </div>
  );
}

/** Compact button for the landing menu. Hidden once installed. */
export function InstallButton({ className = '', tabIndex }: { className?: string; tabIndex?: number }) {
  const state = useInstall();
  const [help, setHelp] = useState(false);
  if (state === 'installed') return null;
  return (
    <>
      <button className={className} tabIndex={tabIndex} onClick={() => (state === 'prompt' ? void promptInstall() : setHelp((h) => !h))}>
        <Icon name="download" size={15} /> Install the app
      </button>
      {help && state !== 'prompt' && <p className="install-help">{STEPS[state]}</p>}
    </>
  );
}
