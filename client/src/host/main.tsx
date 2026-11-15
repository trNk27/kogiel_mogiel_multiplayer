import { render } from 'preact';
import '@fontsource-variable/fraunces/soft.css';
import '@fontsource-variable/nunito';
import '../styles/base.css';
import '../styles/tv.css';
import { HostApp } from './HostApp';
import { HostController } from './controller';
import { looksLikePhone } from './device';

/**
 * One link for everybody: a phone opening "/" is sent to the controller page,
 * while laptops, TVs and tablets get the host screen. "/?host" forces hosting
 * (the join page's "Use this screen as the TV" link), and keeps doing so on a reload.
 */
const params = new URLSearchParams(location.search);
const forceHost = params.has('host') || params.has('autohost') || params.has('new');

if (looksLikePhone() && !forceHost) {
  location.replace(`/join${params.get('code') ? `?code=${encodeURIComponent(params.get('code')!)}` : ''}`);
} else {
  const controller = new HostController();
  // For automated tests: /?debug exposes the room (e.g. `host.finish({...})` ends the current game).
  if (params.has('debug')) (window as unknown as { host: HostController }).host = controller;
  render(<HostApp room={controller} />, document.getElementById('app')!);
}
