import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';

let renderPresentation;
let pendingPresentation;

const deliver = (value) => {
  const presentation = value?.presentation ?? value;
  if (!presentation || typeof presentation !== 'object') return;
  pendingPresentation = presentation;
  renderPresentation?.(JSON.stringify(presentation));
};

window.voiceCanvas = {
  installRenderer(callback) {
    renderPresentation = callback;
    if (pendingPresentation) renderPresentation(JSON.stringify(pendingPresentation));
  },
};

const app = new App(
  { name: 'Pi Voice Canvas', version: '0.1.0' },
  {},
  { autoResize: true },
);
app.ontoolinput = ({ arguments: input }) => deliver(input);
app.ontoolresult = ({ structuredContent }) => deliver(structuredContent);
app.onteardown = async () => ({});
app.onerror = (error) => console.error('[voice-canvas]', error);

await app.connect(new PostMessageTransport(window.parent, window.parent));
