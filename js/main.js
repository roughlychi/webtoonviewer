import { setOnChange } from './state.js';
import { initUi, render } from './ui.js';
import { initScroll } from './scroll.js';

setOnChange(render);
initUi();
initScroll();
render();
