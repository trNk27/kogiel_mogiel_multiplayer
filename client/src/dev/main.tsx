import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '@fontsource-variable/fredoka';
import '../styles/base.css';

/**
 * /dev – the host plus N simulated phones on one screen.
 *   /dev?n=4        number of phones (1–8)
 *   /dev?code=ABCD  attach phones to an existing room instead of creating one
 *   /dev?notv       no TV: the first phone starts the party and hosts it
 */
const params = new URLSearchParams(location.search);
const NOTV = params.has('notv');
const NAMES = ['Babcia', 'Dziadek', 'Kasia', 'Tomek', 'Ola', 'Bartek', 'Zosia', 'Kuba'];

function Dev() {
  const [n, setN] = useState(() => Math.min(8, Math.max(1, Number(params.get('n')) || 4)));
  const [code, setCode] = useState(params.get('code') ?? '');
  const [run] = useState(() => Date.now().toString(36));

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin === location.origin && e.data?.type === 'couch-party-room') setCode(e.data.code);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  return (
    <div class="dev">
      <div class="dev-bar">
        <b>Couch Party · dev</b>
        <span>Room: {code || '…'}</span>
        <label>
          Phones{' '}
          <input type="number" min={1} max={8} value={n} onInput={(e) => setN(Math.min(8, Math.max(1, Number((e.target as HTMLInputElement).value) || 1)))} />
        </label>
        <span class="muted">Click a phone, then use ← → / A D to steer or pedal, space to stab a pierogi or count one (↓ brakes and space fires items in a no-TV rally). Arena games: arrows / WASD move, space and shift are the two buttons.</span>
      </div>
      {!NOTV && <div class="dev-tv">{!params.get('code') && <iframe src={`/?autohost=1&new=1${params.has('debug') ? '&debug=1' : ''}`} title="TV" />}</div>}
      <div class={`dev-phones ${NOTV ? 'notv' : ''}`}>
        {NOTV && <iframe key="host" title="Phone 1 (host)" src={`/join?notv=1&dev=${run}-0&auto=1&name=${encodeURIComponent(NAMES[0])}`} />}
        {code &&
          Array.from({ length: NOTV ? n - 1 : n }, (_, k) => {
            const i = NOTV ? k + 1 : k;
            return (
              <iframe
                key={`${code}-${i}`}
                title={`Phone ${i + 1}`}
                src={`/join?code=${code}&dev=${run}-${i}&auto=1&name=${encodeURIComponent(NAMES[i])}`}
              />
            );
          })}
      </div>
    </div>
  );
}

render(<Dev />, document.getElementById('app')!);
