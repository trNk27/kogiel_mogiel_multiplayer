import { render } from 'preact';
import '@fontsource-variable/fredoka';
import '@fontsource-variable/nunito';
import '../styles/base.css';
import '../styles/tv.css';
import { HostApp } from './HostApp';
import { HostController } from './controller';

/**
 * One link for everybody: a phone opening "/" is sent to the controller page,
 * while laptops, TVs and tablets get the host screen. "/?host" forces hosting.
 */
const params = new URLSearchParams(location.search);
const isPhone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
const forceHost = params.has('host') || params.has('autohost') || params.has('new');

if (isPhone && !forceHost && !HostController.savedSession()) {
  location.replace(`/join${params.get('code') ? `?code=${encodeURIComponent(params.get('code')!)}` : ''}`);
} else {
  render(<HostApp />, document.getElementById('app')!);
}
