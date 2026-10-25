import { randomUUID } from 'node:crypto';
import * as allure from 'allure-js-commons';
import { test, expect, enableFlutterSemantics, expectCleanBrowser } from './fixtures';
import { zipEntry } from './zip-artifact';

test('scratch task completes through the Flutter board and returns its workspace', async ({
  page, browserEvidence,
}, testInfo) => {
  const marker = `c2-${randomUUID().slice(0, 8)}`;
  const filename = `${marker}.txt`;
  const proof: Record<string, unknown> = { marker, scenario: 'scratch-success' };
  await allure.step('Given the C2 durable service starts with a fresh scratch scenario', async () => {
    const configured = await page.request.post('/__fixture/durable/scenario', {
      data: { scenario: 'scratch-success' },
    });
    expect(configured.ok()).toBeTruthy();
    await page.goto('/?view=transcript', { waitUntil: 'networkidle' });
    await enableFlutterSemantics(page);
  });

  const proposal = await allure.step('When I propose a scratch task through the owner route', async () => {
    const response = await page.request.post('/api/tasks', {
      data: { workspace: 'scratch',
        instruction: `In this scratch workspace, create ${filename} containing exactly ${marker} followed by a newline.` },
    });
    expect(response.status()).toBe(201);
    const task = await response.json();
    expect(task.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(task.status).toBe('pending');
    proof.proposalId = task.id;
    return task;
  });

  await allure.step('And I approve the exact proposal in the Flutter task board', async () => {
    await page.getByRole('button', { name: /^Show tasks/ }).click();
    const card = page.locator(`[flt-semantics-identifier="task-${proposal.id}"]`);
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByRole('button', { name: new RegExp(`${marker}.*COMPLETED`) }))
      .toBeVisible();
  });

  await allure.step('Then the completed task exposes a verifiable ZIP artifact', async () => {
    const response = await page.request.get(`/api/tasks/${proposal.id}/artifacts/workspace`);
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('application/zip');
    const archive = await response.body();
    expect(zipEntry(archive, filename).toString('utf8')).toBe(`${marker}\n`);
    const evidence = await (await page.request.get('/__fixture/durable/evidence')).json();
    const task = evidence.tasks.find((item: { id: string }) => item.id === proposal.id);
    expect(task.result.state).toBe('completed');
    expect(task.result.result.artifacts).toContain('workspace');
    expect(evidence.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: `/api/tasks/${proposal.id}/approve`, status: 200 }),
      expect.objectContaining({ path: `/api/tasks/${proposal.id}/artifacts/workspace`, status: 200 }),
    ]));
    await testInfo.attach('c2-durable-evidence', {
      body: Buffer.from(`${JSON.stringify({ ...proof, task, events: evidence.events,
        artifactBytes: archive.length }, null, 2)}\n`), contentType: 'application/json',
    });
  });

  await allure.step('And the browser reports no unexpected errors', async () => {
    const expectedFontAborts = browserEvidence.requestFailures.filter((failure: {
      method: string; url: string; error: string,
    }) => failure.method === 'GET' && failure.error === 'net::ERR_ABORTED'
      && new URL(failure.url).origin === new URL(page.url()).origin
      && [
        '/assets/fonts/MaterialIcons-Regular.otf',
        '/assets/design_system/fonts/SourceCodePro-Regular.ttf',
      ].includes(new URL(failure.url).pathname));
    expect(expectedFontAborts.length).toBeLessThanOrEqual(2);
    expectCleanBrowser({ ...browserEvidence,
      requestFailures: browserEvidence.requestFailures.filter((failure: unknown) =>
        !expectedFontAborts.includes(failure)) });
  });
});

for (const [scenario, expected] of [
  ['worker-failed', 200], ['repository-unavailable', 503], ['approval-conflict', 409],
  ['owner-unavailable', 503],
] as const) {
  test(`${scenario} is visible at the task contract`, async ({ page }, testInfo) => {
    await allure.step(`Given the ${scenario} C2 scenario is selected`, async () => {
      expect((await page.request.post('/__fixture/durable/scenario', { data: { scenario } })).ok())
        .toBeTruthy();
    });
    const task = await allure.step('When a task is proposed and approved', async () => {
      const proposed = await page.request.post('/api/tasks', {
        data: { instruction: 'Review the workspace',
          workspace: scenario === 'repository-unavailable' ? 'repository' : 'scratch' },
      });
      expect(proposed.status()).toBe(201);
      const task = await proposed.json();
      const approved = await page.request.post(`/api/tasks/${task.id}/approve`);
      expect(approved.status()).toBe(expected);
      return task;
    });
    await allure.step('Then the task reports the expected failure or refuses approval', async () => {
      const tasks = await (await page.request.get('/api/tasks')).json();
      const latest = tasks.find((item: { id: string }) => item.id === task.id);
      if (scenario === 'worker-failed') {
        expect(latest.result.state).toBe('failed');
        expect(latest.result.failure.type).toBe('WorkerFailed');
      } else {
        expect(latest.status).toBe('pending');
      }
      await testInfo.attach('c2-durable-failure', {
        body: Buffer.from(`${JSON.stringify({ scenario, task: latest }, null, 2)}\n`),
        contentType: 'application/json',
      });
    });
  });
}

test('completed work with a missing artifact returns an explicit lookup failure', async ({ page }, testInfo) => {
  const marker = `missing-${randomUUID().slice(0, 8)}`;
  const filename = `${marker}.txt`;
  await allure.step('Given the C2 owner completes work but the artifact store loses the ZIP', async () => {
    expect((await page.request.post('/__fixture/durable/scenario', {
      data: { scenario: 'artifact-missing' },
    })).status()).toBe(200);
  });
  const task = await allure.step('When I propose and approve a scratch task', async () => {
    const proposed = await page.request.post('/api/tasks', { data: { workspace: 'scratch',
      instruction: `In this scratch workspace, create ${filename} containing exactly ${marker} followed by a newline.` } });
    expect(proposed.status()).toBe(201);
    const task = await proposed.json();
    expect((await page.request.post(`/api/tasks/${task.id}/approve`)).status()).toBe(200);
    return task;
  });
  await allure.step('Then the public result remains completed and artifact lookup returns 404', async () => {
    const latest = (await (await page.request.get('/api/tasks')).json())
      .find((item: { id: string }) => item.id === task.id);
    expect(latest.result.state).toBe('completed');
    expect((await page.request.get(`/api/tasks/${task.id}/artifacts/workspace`)).status()).toBe(404);
    await testInfo.attach('c2-missing-artifact-evidence', {
      body: Buffer.from(`${JSON.stringify({ task: latest, artifactStatus: 404 }, null, 2)}\n`),
      contentType: 'application/json',
    });
  });
});

test('cancelled or invalid work never exposes a workspace artifact', async ({ page }, testInfo) => {
  await allure.step('Given a fresh durable service rejects an empty proposal', async () => {
    await page.request.post('/__fixture/durable/scenario', {
      data: { scenario: 'scratch-success' },
    });
    expect((await page.request.post('/api/tasks', {
      data: { workspace: 'scratch', instruction: '' },
    })).status()).toBe(400);
  });
  const task = await allure.step('When I cancel a pending scratch proposal', async () => {
    const proposed = await page.request.post('/api/tasks', {
      data: { workspace: 'scratch', instruction: 'Review only' },
    });
    const task = await proposed.json();
    expect((await page.request.post(`/api/tasks/${task.id}/cancel`)).status()).toBe(200);
    return task;
  });
  await allure.step('Then approval conflicts and artifact lookup is denied', async () => {
    expect((await page.request.post(`/api/tasks/${task.id}/approve`)).status()).toBe(409);
    expect((await page.request.get(`/api/tasks/${task.id}/artifacts/workspace`)).status()).toBe(404);
    const latest = (await (await page.request.get('/api/tasks')).json())
      .find((item: { id: string }) => item.id === task.id);
    expect(latest.status).toBe('cancelled');
    await testInfo.attach('c2-durable-cancelled', {
      body: Buffer.from(`${JSON.stringify(latest, null, 2)}\n`), contentType: 'application/json',
    });
  });
});
