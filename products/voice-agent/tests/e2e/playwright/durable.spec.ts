import { randomUUID, createHash } from 'node:crypto';
import * as allure from 'allure-js-commons';
import { test, expect, enableFlutterSemantics, expectCleanBrowser } from './fixtures';
import { zipEntry } from './zip-artifact';

test('I submit a task from a voice session and follow it in Flutter', async ({
  page, browserEvidence,
}, testInfo) => {
  test.setTimeout(720_000);
  await allure.epic('Durable work');
  await allure.feature('Task execution');
  await allure.story('Submit from a voice session and follow the same native task in Flutter');
  const marker = `durable-e2e-${randomUUID().slice(0, 8)}`;
  const filename = `${marker}.txt`;
  const instruction = `In this scratch workspace, create ${filename} containing exactly ${marker} followed by a newline. Verify the file contents, then report completion. Do not access the network or modify other files.`;
  const proof: Record<string, unknown> = { marker, workspace: 'scratch', states: [] };
  let taskId = '';
  let terminal = false;

  try {
    let existingTaskIds: string[] = [];
    await allure.step('Given the active voice session and Pi Durable owner are available', async () => {
      await page.goto('/?view=transcript', { waitUntil: 'networkidle' });
      await enableFlutterSemantics(page);
      const sessionId = await page.evaluate(async () => {
        const response = await fetch('/api/pi-sessions', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Pi session list returned ${response.status}`);
        const { sessions } = await response.json();
        const active = sessions.find((session: { active: boolean; messageCount: number }) =>
          session.active && session.messageCount > 0);
        const priorDurable = sessions.find((session: { title: string; messageCount: number }) =>
          session.title.startsWith('Submit a new Pi Durable task now.') && session.messageCount > 0);
        const selected = active ?? priorDurable;
        if (!selected) return null;
        const resumed = await fetch(`/api/pi-sessions/${encodeURIComponent(selected.id)}/resume`, {
          method: 'POST',
        });
        if (!resumed.ok) throw new Error(`Pi session resume returned ${resumed.status}`);
        return selected.id as string;
      });
      if (sessionId) {
        proof.sessionId = sessionId;
        await page.reload({ waitUntil: 'networkidle' });
        await enableFlutterSemantics(page);
      }
      await expect(page.getByRole('textbox', { name: 'Message Pi…' })).toBeVisible();
      const existing = await page.evaluate(async () => {
        const response = await fetch('/api/tasks?limit=100', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Task list returned ${response.status}`);
        return response.json();
      });
      existingTaskIds = existing.map((task: { id: string }) => task.id);
      proof.existingTaskCount = existingTaskIds.length;
    });

    await allure.step('When I ask Pi in this session to submit a scratch task', async () => {
      const message = `Submit a new Pi Durable task now. Use the scratch workspace and this exact instruction: ${instruction}`;
      const composer = page.getByRole('textbox', { name: 'Message Pi…' });
      await composer.fill(message);
      await expect(composer).toHaveValue(message);
      const responsePromise = page.waitForResponse((response) =>
        response.url().endsWith('/api/pi-message') && response.request().method() === 'POST',
      { timeout: 150_000 });
      await page.getByRole('button', { name: 'Send message' }).click();
      const response = await responsePromise;
      expect(response.ok()).toBeTruthy();
      const sessionResponse = await response.json();
      expect(typeof sessionResponse.spoken).toBe('string');
      proof.sessionResponseReceived = sessionResponse.spoken.length > 0;
      proof.submissionToolUnavailable = /submission tool is unavailable/iu.test(sessionResponse.spoken);

      let submitted: any;
      await expect.poll(async () => {
        const tasks = await page.evaluate(async () => {
          const result = await fetch('/api/tasks?limit=100', { cache: 'no-store' });
          if (!result.ok) throw new Error(`Task list returned ${result.status}`);
          return result.json();
        });
        submitted = tasks.find((task: { id: string; instruction: string }) =>
          !existingTaskIds.includes(task.id) && task.instruction.includes(marker));
        return submitted?.status ?? 'not-submitted';
      }, { timeout: 60_000, intervals: [500, 1000, 2000] }).toBe('submitted');
      expect(submitted.workspace).toBe('scratch');
      expect(submitted.id).toMatch(/^[0-9a-f-]{36}$/);
      taskId = submitted.id;
      proof.taskId = taskId;
    });

    await allure.step('Then I follow the same native task in the Flutter task board', async () => {
      await page.getByRole('button', { name: /^Show tasks/ }).click();
      const card = page.locator(`[flt-semantics-identifier="task-${taskId}"]`);
      await expect(card).toBeVisible();
      await expect(card.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
      await expect.poll(async () => {
        const tasks = await page.evaluate(async () => {
          const response = await fetch('/api/tasks?limit=100', { cache: 'no-store' });
          if (!response.ok) throw new Error(`Task list returned ${response.status}`);
          return response.json();
        });
        const task = tasks.find((item: { id: string }) => item.id === taskId);
        if (!task) throw new Error(`Task ${taskId} is not visible in the task board`);
        return task.result?.state ?? 'missing-result';
      }, { timeout: 30_000 }).toMatch(/^(pending|running|completed|failed)$/u);
    });

    await allure.step('When I choose Listen to agent for this task', async () => {
      const card = page.locator(`[flt-semantics-identifier="task-${taskId}"]`);
      const narrationResponse = page.waitForResponse((response) =>
        response.url().endsWith(`/api/tasks/${taskId}/narration`)
          && response.request().method() === 'POST',
        { timeout: 90_000 },
      );
      const speechResponse = page.waitForResponse((response) =>
        response.url().endsWith('/api/pi-speech')
          && response.request().method() === 'POST'
          && typeof response.request().postDataJSON()?.spoken === 'string'
          && response.request().postDataJSON().spoken.length > 0,
        { timeout: 90_000 },
      );
      const mediaRequest = page.waitForRequest((request) =>
        request.url().startsWith('blob:') && request.resourceType() === 'media',
        { timeout: 90_000 },
      );
      await card.getByRole('button', { name: 'Listen to agent' }).click();
      await expect(card.getByRole('button', { name: 'Stop listening' })).toBeVisible();
      const narration = await narrationResponse;
      expect(narration.ok()).toBeTruthy();
      const narrationBody = await narration.json();
      expect(typeof narrationBody.spoken).toBe('string');
      expect(narrationBody.spoken.length).toBeGreaterThan(0);
      const response = await speechResponse;
      expect(response.ok()).toBeTruthy();
      expect(response.headers()['content-type']).toMatch(/^audio\//u);
      expect(response.request().postDataJSON().spoken).toBe(narrationBody.spoken);
      const audioBytes = Number(response.headers()['content-length']);
      expect(audioBytes).toBeGreaterThan(44);
      const media = await mediaRequest;
      expect(media.url()).toMatch(/^blob:/u);
      proof.taskNarration = {
        enabled: true,
        speechStatus: response.status(),
        contentType: response.headers()['content-type'],
        audioBytes,
        narrationCharacters: narrationBody.spoken.length,
        browserAudioPlaybackRequested: true,
      };
    });

    const completed = await allure.step('Then the isolated worker completes the queued task', async () => {
      let latest: any;
      await expect.poll(async () => {
        const tasks = await page.evaluate(async () => {
          const response = await fetch('/api/tasks?limit=100', { cache: 'no-store' });
          if (!response.ok) throw new Error(`Task list returned ${response.status}`);
          return response.json();
        });
        latest = tasks.find((task: { id: string }) => task.id === taskId);
        if (!latest) throw new Error(`Task ${taskId} disappeared from the owner list`);
        const state = latest.result?.state ?? latest.status;
        if ((proof.states as string[]).at(-1) !== state) (proof.states as string[]).push(state);
        if (['failed', 'cancelled'].includes(state)) throw new Error(`Durable task ended ${state}`);
        return state;
      }, { timeout: 600_000, intervals: [1000, 3000, 5000] }).toBe('completed');
      terminal = true;
      expect(latest.task_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(latest.result?.result?.exit_code).toBe(0);
      expect(latest.result?.result?.artifacts).toContain('workspace');
      proof.taskId = latest.task_id;
      return latest;
    });

    await allure.step('And I retrieve the completed workspace artifact through the browser', async () => {
      const card = page.locator(`[flt-semantics-identifier="task-${taskId}"]`);
      await expect(card).toBeVisible();
      await expect(card).toHaveAccessibleName(/COMPLETED/);
      const artifact = await page.evaluate(async (id) => {
        const response = await fetch(`/api/tasks/${id}/artifacts/workspace`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Workspace download returned ${response.status}`);
        return {
          type: response.headers.get('content-type'),
          disposition: response.headers.get('content-disposition'),
          bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
        };
      }, taskId);
      expect(artifact.type).toContain('application/zip');
      expect(artifact.disposition).toContain('workspace.zip');
      const archive = Buffer.from(artifact.bytes);
      expect(zipEntry(archive, filename).toString('utf8').trim()).toBe(marker);
      proof.artifactBytes = archive.length;
      proof.artifactSha256 = createHash('sha256').update(archive).digest('hex');
      proof.verifiedEntry = filename;
      proof.finalState = completed.result.state;
    });

    await allure.step('And the browser reports no unexpected errors', async () => {
      const expectedAborts = browserEvidence.requestFailures.filter((failure: {
        method: string; url: string; error: string,
      }) => failure.method === 'GET' && failure.error === 'net::ERR_ABORTED'
        && new URL(failure.url).origin === new URL(page.url()).origin
        && ['/api/tasks', '/api/pi-context', '/api/pi-transcript', '/api/pi-sessions']
          .includes(new URL(failure.url).pathname));
      expect(expectedAborts.length).toBeLessThanOrEqual(3);
      proof.expectedNavigationAborts = expectedAborts.map((failure: { url: string }) =>
        new URL(failure.url).pathname);
      expectCleanBrowser({
        ...browserEvidence,
        requestFailures: browserEvidence.requestFailures.filter((failure: unknown) =>
          !expectedAborts.includes(failure)),
      });
    });
  } finally {
    if (taskId && !terminal) {
      try {
        await page.evaluate(async (id) => {
          await fetch(`/api/tasks/${id}/cancel`, { method: 'POST' });
        }, taskId);
        proof.cleanup = 'cancel requested';
      } catch (error) {
        proof.cleanup = `cancel unavailable: ${String(error)}`;
      }
    }
    await testInfo.attach('durable-task-evidence', {
      body: Buffer.from(`${JSON.stringify(proof, null, 2)}\n`), contentType: 'application/json',
    });
  }
});
