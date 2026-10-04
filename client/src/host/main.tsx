import { render } from 'preact';
import '@fontsource-variable/fredoka';
import '@fontsource-variable/nunito';
import '../styles/base.css';
import '../styles/tv.css';
import { HostApp } from './HostApp';

render(<HostApp />, document.getElementById('app')!);
