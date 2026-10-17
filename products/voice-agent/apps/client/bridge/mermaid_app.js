import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import mermaid from 'mermaid';

const MAX_NODES = 24;
const MAX_EDGES = 48;
let revision = 0;

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  suppressErrorRendering: true,
  theme: 'dark',
  flowchart: { htmlLabels: false, useMaxWidth: true },
});

const root = document.querySelector('#app');

const normalizedText = (value, fallback = '') => (
  typeof value === 'string'
    ? value.replace(/\s+/gu, ' ').trim().slice(0, 240)
    : fallback
);

const quotedLabel = (value) => `"${normalizedText(value, 'Untitled')
  .replace(/&/gu, '&amp;')
  .replace(/"/gu, '&quot;')
  .replace(/</gu, '&lt;')
  .replace(/>/gu, '&gt;')}"`;

const edgeLabel = (value) => normalizedText(value)
  .replace(/[|<>"'{}\[\]`]/gu, '')
  .slice(0, 120);

const sourceFromPresentation = (presentation) => {
  const rawNodes = Array.isArray(presentation?.nodes)
    ? presentation.nodes.slice(0, MAX_NODES)
    : [];
  const rawEdges = Array.isArray(presentation?.edges)
    ? presentation.edges.slice(0, MAX_EDGES)
    : [];
  const nodes = rawNodes.filter((node) => (
    node && typeof node === 'object' && typeof node.id === 'string'
  ));
  if (!nodes.length) throw new Error('Mermaid presentation has no nodes');

  const aliases = new Map(nodes.map((node, index) => [node.id, `n${index}`]));
  const lines = ['flowchart TD'];
  for (const node of nodes) {
    lines.push(`  ${aliases.get(node.id)}[${quotedLabel(node.label)}]`);
  }
  for (const edge of rawEdges) {
    const source = aliases.get(edge?.from);
    const target = aliases.get(edge?.to);
    if (!source || !target) continue;
    const label = edgeLabel(edge.label);
    lines.push(label
      ? `  ${source} -->|${label}| ${target}`
      : `  ${source} --> ${target}`);
  }
  return lines.join('\n');
};

const renderPresentation = async (value) => {
  const presentation = value?.presentation ?? value;
  if (!presentation || typeof presentation !== 'object' || !root) return;
  try {
    const source = sourceFromPresentation(presentation);
    await mermaid.parse(source);
    const id = `pi-mermaid-${revision += 1}`;
    const { svg, bindFunctions } = await mermaid.render(id, source);
    root.replaceChildren();
    const title = document.createElement('h1');
    title.textContent = normalizedText(presentation.title, 'Pi response');
    const diagram = document.createElement('div');
    diagram.className = 'diagram';
    diagram.setAttribute('role', 'img');
    diagram.setAttribute('aria-label', title.textContent);
    diagram.innerHTML = svg;
    root.append(title, diagram);
    bindFunctions?.(diagram);
  } catch (error) {
    root.replaceChildren();
    const message = document.createElement('p');
    message.className = 'error';
    message.textContent = 'Diagram unavailable';
    root.append(message);
    console.error('[mermaid-app]', error);
  }
};

const app = new App(
  { name: 'Pi Mermaid', version: '0.1.0' },
  {},
  { autoResize: true },
);
app.ontoolinput = ({ arguments: input }) => void renderPresentation(input);
app.ontoolresult = ({ structuredContent }) => void renderPresentation(structuredContent);
app.onteardown = async () => ({});
app.onerror = (error) => console.error('[mermaid-app]', error);

void app.connect(new PostMessageTransport(window.parent, window.parent)).catch(
  (error) => console.error('[mermaid-app]', error),
);
