import { randomUUID } from 'node:crypto';
import * as allure from 'allure-js-commons';
import { test, expect, enableFlutterSemantics } from './fixtures';
import { zipEntry } from './zip-artifact';
import { captureResponsiveLayout, responsiveViewports } from './responsive-layout';
import { expectCleanFlutterBrowser } from './flutter-browser';

test('durable task board stays usable across mobile, tablet, and desktop', async ({ page, browserEvidence }, testInfo) => {
  expect((await page.request.post('/__fixture/durable/scenario', {
    data: { scenario: 'scratch-success' },
  })).ok()).toBeTruthy();
  const submitted = await page.request.post('/api/tasks', {
    data: { workspace: 'scratch', instruction: 'Review this responsive task board' },
  });
  expect(submitted.status()).toBe(201);
  const task = await submitted.json();
  for (const viewport of responsiveViewports) {
    await allure.step(`Given the task board opens at ${viewport.name} resolution`, async () => {
      await page.setViewportSize(viewport);
      await page.goto('/?view=transcript', { waitUntil: 'networkidle' });
      await enableFlutterSemantics(page);
      await page.getByRole('button', { name: viewport.name === 'desktop'
        ? /^Tasks \d+ recent/ : /^Show tasks/ }).click();
      await expect(page.locator(`[flt-semantics-identifier="task-${task.id}"]`)).toBeVisible();
      await captureResponsiveLayout(page, testInfo, 'durable-task-board', viewport);
    });
  }
  await allure.step('Then the browser reports no unexpected errors', async () => {
    expectCleanFlutterBrowser(page, browserEvidence, 12);
  });
});

test('voice session submits directly to Pi Durable and I follow the task in Flutter', async ({
  page, browserEvidence,
}, testInfo) => {
  const marker = `session-${randomUUID().slice(0, 8)}`;
  const filename = `${marker}.txt`;
  const instruction = `create ${filename} containing exactly ${marker} followed by a newline.`;
  const proof: Record<string, unknown> = { marker, filename, instruction };

  await allure.epic('Durable work');
  await allure.feature('Task execution');
  await allure.story('Submit from a voice session and follow the same native task in Flutter');

  await allure.step('Given I am in my voice session and the Pi Durable owner is available', async () => {
    const configured = await page.request.post('/__fixture/durable/scenario', {
      data: { scenario: 'direct-submit' },
    });
    expect(configured.ok()).toBeTruthy();
    await page.goto('/?view=transcript', { waitUntil: 'networkidle' });
    await enableFlutterSemantics(page);
  });

  const task = await allure.step('When I ask Pi in this session to submit a scratch task', async () => {
    await page.getByRole('textbox', { name: 'Message Pi…' })
      .fill(`Submit a scratch task: ${instruction}`);
    const responsePromise = page.waitForResponse((response) =>
      response.url().endsWith('/api/pi-message') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Send message' }).click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    const sessionResponse = await response.json();
    expect(sessionResponse.spoken).toContain('Submitted directly to Pi Durable');

    const evidence = await (await page.request.get('/__fixture/durable/evidence')).json();
    expect(evidence.events).toContainEqual(expect.objectContaining({
      method: 'POST', path: '/api/tasks', status: 201,
    }));
    const submitted = evidence.tasks[0];
    expect(submitted.status).toBe('submitted');
    expect(submitted.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(submitted.task_id).toBe(submitted.id);
    proof.taskId = submitted.task_id;
    proof.sessionResponse = sessionResponse;
    return submitted;
  });

  await allure.step('Then the Flutter task board follows that same submitted task', async () => {
    await page.getByRole('button', { name: /^Show tasks/ }).click();
    const card = page.locator(`[flt-semantics-identifier="task-${task.id}"]`);
    await expect(card).toBeVisible();
    await expect(card).toHaveAccessibleName(new RegExp(marker));
    await expect(card.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
    const listed = await page.request.get('/api/tasks?limit=100');
    expect(listed.ok()).toBeTruthy();
    expect((await listed.json()).map((item: { id: string }) => item.id)).toContain(task.id);
  });

  await allure.step('Then the task result and its artifact are available through the web UI', async () => {
    const latest = await page.request.get(`/api/tasks/${task.id}`);
    expect(latest.ok()).toBeTruthy();
    const result = await latest.json();
    expect(result.result.state).toBe('completed');
    const artifact = await page.request.get(`/api/tasks/${task.id}/artifacts/workspace`);
    expect(artifact.ok()).toBeTruthy();
    expect(zipEntry(await artifact.body(), filename).toString('utf8')).toBe(`${marker}\n`);
    proof.result = result.result;
    proof.artifactBytes = (await artifact.body()).length;
    await testInfo.attach('voice-session-pi-durable-journey', {
      body: Buffer.from(`${JSON.stringify(proof, null, 2)}\n`),
      contentType: 'application/json',
    });
  });

  await allure.step('And the browser reports no unexpected errors', async () => {
    expectCleanFlutterBrowser(page, browserEvidence, 4);
  });
});

test('directly submitted scratch task completes through the Flutter board and returns its workspace', async ({
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

  const task = await allure.step('When I submit a scratch task directly to the owner route', async () => {
    const response = await page.request.post('/api/tasks', {
      data: { workspace: 'scratch',
        instruction: `In this scratch workspace, create ${filename} containing exactly ${marker} followed by a newline.` },
    });
    expect(response.status()).toBe(201);
    const task = await response.json();
    expect(task.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(task.status).toBe('submitted');
    expect(task.task_id).toBe(task.id);
    proof.taskId = task.id;
    return task;
  });

  await allure.step('And I follow the same task in the Flutter task board', async () => {
    await page.getByRole('button', { name: /^Show tasks/ }).click();
    const card = page.locator(`[flt-semantics-identifier="task-${task.id}"]`);
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: new RegExp(`${marker}.*COMPLETED`) }))
      .toBeVisible();
  });

  await allure.step('Then the completed task exposes a verifiable ZIP artifact', async () => {
    const response = await page.request.get(`/api/tasks/${task.id}/artifacts/workspace`);
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('application/zip');
    const archive = await response.body();
    expect(zipEntry(archive, filename).toString('utf8')).toBe(`${marker}\n`);
    const evidence = await (await page.request.get('/__fixture/durable/evidence')).json();
    const saved = evidence.tasks.find((item: { id: string }) => item.id === task.id);
    expect(saved.result.state).toBe('completed');
    expect(saved.result.result.artifacts).toContain('workspace');
    expect(evidence.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/api/tasks', method: 'POST', status: 201 }),
      expect.objectContaining({ path: `/api/tasks/${task.id}/artifacts/workspace`, status: 200 }),
    ]));
    await testInfo.attach('c2-durable-evidence', {
      body: Buffer.from(`${JSON.stringify({ ...proof, task: saved, events: evidence.events,
        artifactBytes: archive.length }, null, 2)}\n`), contentType: 'application/json',
    });
  });

  await allure.step('And the browser reports no unexpected errors', async () => {
    expectCleanFlutterBrowser(page, browserEvidence, 4);
  });
});

for (const [scenario, expected] of [
  ['worker-failed', 201], ['repository-unavailable', 503], ['owner-unavailable', 503],
] as const) {
  test(`${scenario} is visible at the task contract`, async ({ page }, testInfo) => {
    await allure.step(`Given the ${scenario} C2 scenario is selected`, async () => {
      expect((await page.request.post('/__fixture/durable/scenario', { data: { scenario } })).ok())
        .toBeTruthy();
    });
    const response = await allure.step('When the session submits directly to the task contract', async () => {
      const submitted = await page.request.post('/api/tasks', {
        data: { instruction: 'Review the workspace',
          workspace: scenario === 'repository-unavailable' ? 'repository' : 'scratch' },
      });
      expect(submitted.status()).toBe(expected);
      return submitted;
    });
    await allure.step('Then the task contract reports the direct submission outcome', async () => {
      if (expected === 503) {
        expect((await response.json()).detail).toMatch(/unavailable/u);
        return;
      }
      const task = await response.json();
      const tasks = await (await page.request.get('/api/tasks')).json();
      const latest = tasks.find((item: { id: string }) => item.id === task.id);
      expect(latest.status).toBe('submitted');
      expect(latest.result.state).toBe('failed');
      expect(latest.result.failure.type).toBe('WorkerFailed');
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
  const task = await allure.step('When I submit a scratch task directly', async () => {
    const submitted = await page.request.post('/api/tasks', { data: { workspace: 'scratch',
      instruction: `In this scratch workspace, create ${filename} containing exactly ${marker} followed by a newline.` } });
    expect(submitted.status()).toBe(201);
    return submitted.json();
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

test('invalid work never reaches Pi Durable or exposes a workspace artifact', async ({ page }, testInfo) => {
  await allure.step('Given a fresh durable service rejects an empty task submission', async () => {
    await page.request.post('/__fixture/durable/scenario', {
      data: { scenario: 'scratch-success' },
    });
    expect((await page.request.post('/api/tasks', {
      data: { workspace: 'scratch', instruction: '' },
    })).status()).toBe(400);
  });
  await allure.step('Then no task record was created for invalid input', async () => {
    const latest = await page.request.get('/api/tasks');
    expect(latest.ok()).toBeTruthy();
    expect(await latest.json()).toHaveLength(0);
    await testInfo.attach('c2-durable-cancelled', {
      body: Buffer.from(`${JSON.stringify({ tasks: await latest.json() }, null, 2)}\n`), contentType: 'application/json',
    });
  });
});
