import { createHash } from 'node:crypto';
import * as allure from 'allure-js-commons';
import { test, expect, enableFlutterSemantics } from './fixtures';
import { zipEntry } from './zip-artifact';

test('submits with Pi Durable CLI and follows the task in Flutter', async ({ page }, testInfo) => {
  test.setTimeout(720_000);
  await allure.epic('Durable work');
  await allure.feature('Task execution');
  await allure.story('Submit with Pi Durable CLI and follow work in Flutter');

  const taskId = process.env.DURABLE_CLI_TEST_TASK_ID;
  const marker = process.env.DURABLE_CLI_TEST_MARKER;
  expect(taskId, 'the operator submitted a native task').toMatch(/^[0-9a-f-]{36}$/);
  expect(marker, 'the operator supplied a unique proof marker').toMatch(/^cli-e2e-\d+$/);
  const proof: Record<string, unknown> = { taskId, marker, states: [] };
  const readTask = async () => {
    const response = await page.request.get('/api/tasks?limit=100');
    expect(response.ok()).toBeTruthy();
    return (await response.json()).find((task: { id: string }) => task.id === taskId);
  };

  try {
    await allure.step('Given a scratch task was submitted through the local Pi Durable CLI', async () => {
      await page.goto('/?view=transcript', { waitUntil: 'networkidle' });
      await enableFlutterSemantics(page);
      const task = await readTask();
      expect(task).toBeDefined();
      expect(task.id).toBe(taskId);
      expect(task.workspace).toBe('scratch');
      expect(task.instruction).toContain(`${marker}.txt`);
      expect(task.status).toBe('approved');
    });

    const card = page.locator(`[flt-semantics-identifier="task-${taskId}"]`);
    await allure.step('When I open the Flutter task board and select this task', async () => {
      await page.getByRole('button', { name: /^Show tasks/ }).click();
      await expect(card).toBeVisible();
      await expect(card).toHaveAccessibleName(new RegExp(marker!));
    });

    await allure.step('And I turn on Listen to agent', async () => {
      await card.getByRole('button', { name: 'Listen to agent' }).click();
      await expect(card.getByRole('button', { name: 'Stop listening' })).toBeVisible();
      proof.listenEnabled = true;
    });

    await allure.step('Then the browser exposes progress from the same native task', async () => {
      await expect.poll(async () => {
        const response = await page.request.get(`/api/tasks/${taskId}/progress?after=0`);
        expect(response.ok()).toBeTruthy();
        const events = await response.json();
        proof.progressCount = events.length;
        return events.length;
      }, { timeout: 120_000, intervals: [1000, 3000, 5000] }).toBeGreaterThan(0);
    });

    await allure.step('And the task completes with a verifiable workspace artifact', async () => {
      let latest: any;
      await expect.poll(async () => {
        latest = await readTask();
        expect(latest).toBeDefined();
        const state = latest.result?.state ?? latest.status;
        if ((proof.states as string[]).at(-1) !== state) (proof.states as string[]).push(state);
        if (['failed', 'cancelled'].includes(state)) throw new Error(`Native task ended ${state}`);
        return state;
      }, { timeout: 600_000, intervals: [1000, 3000, 5000] }).toBe('completed');
      await expect(card).toHaveAccessibleName(/COMPLETED/);
      expect(latest.result.result.exit_code).toBe(0);
      expect(latest.result.result.artifacts).toContain('workspace');
      const artifact = await page.request.get(`/api/tasks/${taskId}/artifacts/workspace`);
      expect(artifact.ok()).toBeTruthy();
      expect(artifact.headers()['content-type']).toContain('application/zip');
      const archive = await artifact.body();
      expect(zipEntry(archive, `${marker}.txt`).toString('utf8')).toBe(`${marker}\n`);
      proof.artifactBytes = archive.length;
      proof.artifactSha256 = createHash('sha256').update(archive).digest('hex');
      proof.finalState = latest.result.state;
    });
  } finally {
    await testInfo.attach('native-cli-flutter-journey', {
      body: Buffer.from(`${JSON.stringify(proof, null, 2)}\n`), contentType: 'application/json',
    });
  }
});
