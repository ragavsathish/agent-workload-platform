import { test, expect, enableFlutterSemantics, expectCleanBrowser } from './fixtures';

test('renders delayed and persisted task diagrams', async ({ page, browserEvidence }) => {
  await page.route('**/api/tasks', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      {
        id: 'playwright-persisted-diagram',
        instruction: 'Render the persisted task diagram',
        workspace: '/workspace',
        plan_hash: 'playwright-fixture',
        status: 'completed',
        created_at: '2026-10-16T12:00:00Z',
        result: {
          state: 'completed',
          result: {
            response: {
              spoken: 'The task diagram is ready.',
              resourceUri: 'ui://mermaid/main',
              presentation: {
                kind: 'flow',
                title: 'Persisted task result',
                nodes: [
                  { id: 'task', label: 'Persisted task' },
                  { id: 'result', label: 'Rendered result' },
                ],
                edges: [{ from: 'task', to: 'result' }],
              },
            },
            artifacts: [],
          },
        },
      },
    ]),
  }));
  await page.goto('/?view=transcript', { waitUntil: 'networkidle' });

  const delayedMount = await page.evaluate(async () => {
    const render = window.voiceBridge.mountMcpApp(
      'delayed-mcp-app-mount',
      JSON.stringify({
        kind: 'flow',
        title: 'Task result',
        nodes: [{ id: 'task', label: 'Task' }, { id: 'result', label: 'Result' }],
        edges: [{ from: 'task', to: 'result' }],
      }),
      'ui://mermaid/main',
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const target = document.createElement('div');
    target.id = 'delayed-mcp-app-mount';
    target.style.width = '320px';
    target.style.height = '200px';
    document.body.append(target);
    return JSON.parse(await render);
  });
  expect(delayedMount.ok).toBe(true);

  let mermaidFrame;
  await expect.poll(() => {
    mermaidFrame = page.frames().find((frame) => frame.url().includes('/mermaid/index.html'));
    return Boolean(mermaidFrame);
  }).toBe(true);
  const diagram = mermaidFrame.locator('.diagram svg');
  await expect(diagram).toBeVisible();
  await expect(diagram).toContainText('Task');
  await expect(diagram).toContainText('Result');

  await page.evaluate(() => document.querySelector('#delayed-mcp-app-mount')?.remove());
  await enableFlutterSemantics(page);
  await page.getByRole('button', { name: /^Show tasks/ }).click({ timeout: 10_000 });
  const taskCard = page.getByRole('group', { name: /^Render the persisted task diagram/ });
  await expect(taskCard).toBeVisible();
  await taskCard.getByRole('button', { name: 'Show diagram', exact: true }).click();
  const persistedFrame = page.locator('iframe[title="Pi Mermaid diagram"]');
  await expect(persistedFrame).toBeVisible();
  await expect(persistedFrame).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(page.getByText('Visual unavailable', { exact: true })).toHaveCount(0);
  expectCleanBrowser(browserEvidence);
});
