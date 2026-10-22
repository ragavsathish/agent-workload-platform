import { Marp } from '@marp-team/marp-core';
import { browser } from '@marp-team/marp-core/browser';
import katexPlugin from '@marp-team/marp-core/plugins/katex';
import mermaidPlugin from '@marp-team/marp-core/plugins/mermaid';
import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import '../design_system/elements.css';

const MAX_MARKDOWN_BYTES = 64 * 1024;
const deck = document.querySelector('#deck');
const controls = document.querySelector('#controls');
const previous = document.querySelector('#previous');
const next = document.querySelector('#next');
const position = document.querySelector('#position');
const marp = new Marp({ html: false, script: false })
  .use(katexPlugin({ fontPath: './fonts/' }))
  .use(mermaidPlugin());

let page = 0;
let slides = [];
let style;
let browserControl;

const withoutExternalImports = (value) => value.replace(
  /@import\s+url\([^)]*\)\s*;/giu,
  '',
);

const updateNavigation = () => {
  slides.forEach((slide, index) => slide.toggleAttribute('data-active', index === page));
  previous.disabled = page === 0;
  next.disabled = page >= slides.length - 1;
  position.textContent = slides.length ? `${page + 1} / ${slides.length}` : '';
  controls.hidden = slides.length <= 1;
};

const showPage = (candidate) => {
  page = Math.max(0, Math.min(candidate, slides.length - 1));
  updateNavigation();
};

previous.addEventListener('click', () => showPage(page - 1));
next.addEventListener('click', () => showPage(page + 1));
document.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') showPage(page - 1);
  if (event.key === 'ArrowRight') showPage(page + 1);
});

let touchStartX;
deck.addEventListener('touchstart', (event) => {
  touchStartX = event.changedTouches[0]?.clientX;
}, { passive: true });
deck.addEventListener('touchend', (event) => {
  const endX = event.changedTouches[0]?.clientX;
  if (typeof touchStartX !== 'number' || typeof endX !== 'number') return;
  const distance = endX - touchStartX;
  if (Math.abs(distance) > 48) showPage(page + (distance < 0 ? 1 : -1));
  touchStartX = undefined;
}, { passive: true });

const markdownFrom = (value) => {
  const presentation = value?.presentation ?? value;
  const markdown = presentation?.markdown;
  if (typeof markdown !== 'string' || !markdown.trim()) {
    throw new Error('Marp presentation has no Markdown');
  }
  if (new TextEncoder().encode(markdown).byteLength > MAX_MARKDOWN_BYTES) {
    throw new Error('Marp presentation is too large');
  }
  return markdown;
};

const renderPresentation = (value) => {
  if (!deck) return;
  try {
    const markdown = markdownFrom(value);
    const rendered = marp.render(markdown);
    style?.remove();
    style = document.createElement('style');
    style.dataset.marpTheme = '';
    style.textContent = withoutExternalImports(rendered.css);
    document.head.append(style);
    deck.innerHTML = withoutExternalImports(rendered.html);
    browserControl = browser(deck);
    deck.dataset.marpBrowserReady = 'true';
    slides = [...deck.querySelectorAll('svg[data-marpit-svg]')];
    if (!slides.length) throw new Error('Marp rendered no slides');
    page = 0;
    updateNavigation();
  } catch (error) {
    slides = [];
    controls.hidden = true;
    deck.replaceChildren();
    const message = document.createElement('p');
    message.id = 'error';
    message.textContent = 'Slides unavailable';
    deck.append(message);
    console.error('[marp-app]', error);
  }
};

const app = new App(
  { name: 'Pi Marp Slides', version: '0.1.0' },
  {},
  { autoResize: true },
);
app.ontoolinput = ({ arguments: input }) => renderPresentation(input);
app.ontoolresult = ({ structuredContent }) => renderPresentation(structuredContent);
app.onteardown = async () => {
  browserControl?.cleanup();
  browserControl = undefined;
  delete deck.dataset.marpBrowserReady;
  return {};
};
app.onerror = (error) => console.error('[marp-app]', error);

void app.connect(new PostMessageTransport(window.parent, window.parent)).catch(
  (error) => console.error('[marp-app]', error),
);
