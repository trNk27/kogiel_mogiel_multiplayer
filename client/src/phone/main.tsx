import { render } from 'preact';
import '@fontsource-variable/fraunces/soft.css';
import '@fontsource-variable/nunito';
import '../styles/base.css';
import '../styles/phone.css';
import { PhoneApp } from './PhoneApp';

// No pinch-zoom or double-tap zoom on iOS (it ignores user-scalable=no).
document.addEventListener('gesturestart', (e) => e.preventDefault());
let lastTouchEnd = 0;
document.addEventListener(
  'touchend',
  (e) => {
    const now = Date.now();
    if (now - lastTouchEnd < 300 && !(e.target as HTMLElement).closest('input')) e.preventDefault();
    lastTouchEnd = now;
  },
  { passive: false },
);

render(<PhoneApp />, document.getElementById('app')!);
