import { render } from 'preact';
import '@fontsource-variable/fraunces/soft.css';
import '@fontsource-variable/nunito';
import '../styles/base.css';
import '../styles/screen.css';
import { ScreenApp } from './ScreenApp';

render(<ScreenApp />, document.getElementById('app')!);
