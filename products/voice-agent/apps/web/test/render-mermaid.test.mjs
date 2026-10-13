import assert from 'node:assert/strict';
import test from 'node:test';

import { renderMermaidInto } from '../src/render-mermaid.ts';

test('a failed Mermaid update keeps the last valid diagram visible', async () => {
  const container = {
    innerHTML: '',
    replaceChildren() {
      this.innerHTML = '';
    },
  };
  const renderIds = [];
  const render = async (renderId, diagram) => {
    renderIds.push(renderId);
    if (diagram.includes('Incomplete')) {
      if (renderIds.at(-2) === renderId) container.replaceChildren();
      throw new Error('Mermaid parse error');
    }
    return { svg: '<svg data-diagram="last-valid"></svg>' };
  };

  assert.equal(
    await renderMermaidInto({
      container,
      diagram: 'flowchart TD\n  A[Valid]',
      renderIdPrefix: 'voice-diagram-test',
      render,
      isCurrent: () => true,
    }),
    true
  );

  const rendered = await renderMermaidInto({
    container,
    diagram: 'flowchart TD\n  A[Incomplete',
    renderIdPrefix: 'voice-diagram-test',
    render,
    isCurrent: () => true,
  });

  assert.equal(rendered, false);
  assert.notEqual(renderIds[0], renderIds[1]);
  assert.equal(container.innerHTML, '<svg data-diagram="last-valid"></svg>');
});
