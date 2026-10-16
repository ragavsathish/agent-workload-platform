import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { commands } from 'vitest/browser';

const presentations = [
  {
    name: 'Mermaid',
    uri: 'ui://mermaid/main',
    title: 'Pi Mermaid diagram',
    src: '/mermaid/index.html',
    selector: '.diagram svg',
    labels: ['Browser [voice]', 'Pi "agent"'],
    value: {
      kind: 'flow',
      title: 'Voice path',
      nodes: [
        { id: 'browser', label: 'Browser [voice]' },
        { id: 'pi', label: 'Pi "agent"' },
      ],
      edges: [{ from: 'browser', to: 'pi', label: 'safe | route' }],
    },
  },
  {
    name: 'Marp',
    uri: 'ui://slides/marp.html',
    title: 'Pi Marp slides',
    src: '/marp/marp.html',
    selector: 'svg[data-marpit-svg][data-active]',
    labels: ['Voice slides'],
    measureDeck: true,
    nextSelector: 'svg[data-marpit-svg][data-active] svg[data-marp-mermaid]',
    nextLabels: ['Voice', 'Pi'],
    value: {
      kind: 'slides',
      title: 'Voice slides',
      markdown: [
        '---',
        'marp: true',
        '---',
        '# Voice slides',
        '',
        'A Marp presentation rendered inside Flutter Web.',
        '',
        '---',
        '',
        '# Embedded Mermaid',
        '',
        '```mermaid',
        'flowchart LR',
        '  Voice --> Pi',
        '```',
      ].join('\n'),
    },
  },
  {
    name: 'Excalidraw',
    uri: 'ui://excalidraw/mcp-app.html',
    title: 'Editable Excalidraw diagram',
    src: '/excalidraw/mcp-app.html',
    selector: '.excalidraw-container svg',
    labels: ['Voice', 'Pi'],
    value: {
      kind: 'excalidraw',
      title: 'Voice architecture',
      elements: [
        { type: 'cameraUpdate', x: 0, y: 0, width: 800, height: 600 },
        {
          type: 'rectangle', id: 'voice', x: 80, y: 120, width: 180, height: 80,
          backgroundColor: '#a5d8ff', fillStyle: 'solid', label: { text: 'Voice', fontSize: 20 },
        },
        {
          type: 'arrow', id: 'voice-to-pi', x: 260, y: 160, width: 180, height: 0,
          points: [[0, 0], [180, 0]], endArrowhead: 'arrow',
        },
        {
          type: 'rectangle', id: 'pi', x: 440, y: 120, width: 180, height: 80,
          backgroundColor: '#b2f2bb', fillStyle: 'solid', label: { text: 'Pi', fontSize: 20 },
        },
      ],
    },
  },
  {
    name: 'Marp math',
    uri: 'ui://slides/marp.html',
    title: 'Pi Marp slides',
    src: '/marp/marp.html',
    selector: 'svg[data-marpit-svg][data-active]',
    mathSelector: '.katex',
    labels: ['VoxLock filtering'],
    value: {
      kind: 'slides',
      title: 'VoxLock filtering',
      markdown: [
        '# VoxLock filtering',
        '',
        '- Runs in Voice Edge before speech-to-text',
        '',
        '---',
        '',
        '# Signal measurements',
        '',
        '$$',
        '\\operatorname{RMS}(x)=\\sqrt{\\frac{1}{N}\\sum_{n=0}^{N-1}x[n]^2}',
        '$$',
      ].join('\n'),
    },
  },
  {
    name: 'Excalidraw malformed camera recovery',
    uri: 'ui://excalidraw/mcp-app.html',
    title: 'Editable Excalidraw diagram',
    src: '/excalidraw/mcp-app.html',
    selector: '.excalidraw-container svg',
    labels: ['Recovered voice', 'Recovered Pi'],
    value: {
      kind: 'excalidraw',
      title: 'Recovered transcript drawing',
      elements: [
        { type: 'cameraUpdate', x: 0, y: 0, width: 0, height: 0 },
        {
          type: 'rectangle', id: 'recovered-voice', x: 80, y: 120, width: 180, height: 80,
          backgroundColor: '#a5d8ff', fillStyle: 'solid', label: 'Recovered voice',
        },
        {
          type: 'rectangle', id: 'recovered-pi', x: 440, y: 120, width: 180, height: 80,
          backgroundColor: '#b2f2bb', fillStyle: 'solid', label: 'Recovered Pi',
        },
      ],
    },
  },
];

const hostId = 'mcp-app-test-host';

const makeHost = () => {
  const host = document.createElement('div');
  host.id = hostId;
  Object.assign(host.style, { width: '360px', height: '700px', overflow: 'hidden' });
  document.body.append(host);
  return host;
};

const mount = async (presentation) => {
  const result = JSON.parse(await window.voiceBridge.mountMcpApp(
    hostId,
    JSON.stringify(presentation.value),
    presentation.uri,
  ));
  expect(result, result.error).toMatchObject({ ok: true });
  const iframe = document.querySelector(`#${hostId} iframe`);
  expect(iframe).toBeInstanceOf(HTMLIFrameElement);
  return iframe;
};

beforeAll(async () => {
  await import(/* @vite-ignore */ `${window.location.origin}/voice-runtime/voice_bridge.js`);
  await vi.waitFor(() => expect(window.voiceBridge).toBeDefined());
});

beforeEach(() => {
  document.body.replaceChildren();
  makeHost();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('MCP App renderers', () => {
  for (const presentation of presentations) {
    test(`renders ${presentation.name} inside the least-privilege sandbox`, async () => {
      const iframe = await mount(presentation);
      expect(iframe.title).toBe(presentation.title);
      expect(iframe.getAttribute('src')).toBe(presentation.src);
      expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
      expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin');
      expect(iframe.getAttribute('allow')).toBe(
        presentation.uri === 'ui://excalidraw/mcp-app.html'
          ? 'fullscreen; clipboard-write'
          : 'fullscreen',
      );

      const rendered = await commands.inspectMcpFrame({
        title: presentation.title,
        selector: presentation.selector,
        mathSelector: presentation.mathSelector,
        measureDeck: presentation.measureDeck,
      });
      for (const label of presentation.labels) expect(rendered.text).toContain(label);
      if (presentation.mathSelector) expect(rendered.mathCount).toBeGreaterThan(0);
      if (rendered.fit) {
        expect(rendered.fit.slideWidth).toBeLessThanOrEqual(rendered.fit.deckWidth + 1);
        expect(rendered.fit.slideHeight).toBeLessThanOrEqual(rendered.fit.deckHeight + 1);
      }

      if (presentation.nextSelector) {
        await commands.clickMcpFrame({ title: presentation.title, selector: '#next' });
        const next = await commands.inspectMcpFrame({
          title: presentation.title,
          selector: presentation.nextSelector,
        });
        for (const label of presentation.nextLabels) expect(next.text).toContain(label);
      }
    });
  }

  test('rejects resources outside the explicit MCP App allowlist', async () => {
    const result = JSON.parse(await window.voiceBridge.mountMcpApp(
      hostId,
      JSON.stringify({ kind: 'flow' }),
      'ui://untrusted/app.html',
    ));

    expect(result).toEqual({ ok: false, error: 'Unsupported MCP App resource' });
    expect(document.querySelector(`#${hostId} iframe`)).toBeNull();
    expect(document.getElementById(hostId).textContent).toBe('Visual unavailable');
  });

  test('serializes concurrent mounts and keeps the latest visual', async () => {
    const [firstResult, secondResult] = await Promise.all([
      window.voiceBridge.mountMcpApp(
        hostId,
        JSON.stringify(presentations[0].value),
        presentations[0].uri,
      ),
      window.voiceBridge.mountMcpApp(
        hostId,
        JSON.stringify(presentations[1].value),
        presentations[1].uri,
      ),
    ]);

    expect(JSON.parse(firstResult)).toMatchObject({ ok: true });
    expect(JSON.parse(secondResult)).toMatchObject({ ok: true });
    const iframe = document.querySelector(`#${hostId} iframe`);
    expect(iframe.title).toBe('Pi Marp slides');
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    const rendered = await commands.inspectMcpFrame({
      title: 'Pi Marp slides',
      selector: 'svg[data-marpit-svg][data-active]',
    });
    expect(rendered.text).toContain('Voice slides');
  });
});
