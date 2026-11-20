import { Six7Engine } from './audio/engine';
import { createPanel, type Panel } from './ui/panel';
import { fitMachine } from './ui/fit';

declare global {
  interface Window {
    six7?: Six7Engine;
  }
}

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('the page is missing its #app element');
}

const engine = new Six7Engine();

const heading = document.createElement('h1');
heading.className = 'visually-hidden';
heading.textContent = 'Six7 FM synthesizer';
app.append(heading);

const stage = document.createElement('div');
stage.className = 'stage';
app.append(stage);

const panelHost = document.createElement('div');
panelHost.className = 'panel-host';
stage.append(panelHost);

const panel: Panel = createPanel(panelHost, engine);
fitMachine(panelHost);

engine.onError((message) => {
  panel.showError(message);
});

// The graph is built while the page loads. The first gesture only has to
// wake a suspended context up.
void engine.init();

const wake = (): void => {
  void engine.wake();
};
window.addEventListener('pointerdown', wake);
window.addEventListener('keydown', wake);

window.six7 = engine;
