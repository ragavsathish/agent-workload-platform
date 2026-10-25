import { randomUUID, createHash } from 'node:crypto';
import * as allure from 'allure-js-commons';
import { test, expect, enableFlutterSemantics, expectCleanBrowser } from './fixtures';
import { zipEntry } from './zip-artifact';

test('approves real durable work and retrieves its workspace artifact', async ({
  page, browserEvidence,
}, testInfo) => {
  test.setTimeout(720_000);
  const marker = `durable-e2e-${randomUUID().slice(0, 8)}`;
  const filename = `${marker}.txt`;
  const instruction = `In this scratch workspace, create ${filename} containing exactly ${marker} followed by a newline. Verify the file contents, then report completion. Do not access the network or modify other files.`;
  const proof: Record<string, unknown> = { marker, workspace: 'scratch', states: [] };
  let proposalId = '';
  let terminal = false;

  try {
    await allure.step('Given a unique scratch task is proposed through the owner browser route', async () => {
      await page.goto('/?view=transcript', { waitUntil: 'networkidle' });
      await enableFlutterSemantics(page);
      const proposal = await page.evaluate(async (body) => {
        const response = await fetch('/api/tasks', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`Task proposal returned ${response.status}`);
        return response.json();
      }, { instruction, workspace: 'scratch' });
      expect(proposal.status).toBe('pending');
      expect(proposal.workspace).toBe('scratch');
      expect(proposal.id).toMatch(/^[0-9a-f-]{36}$/);
      proposalId = proposal.id;
      proof.proposalId = proposalId;
    });

    await allure.step('When I approve the proposal in the task board', async () => {
      await page.getByRole('button', { name: /^Show tasks/ }).click();
      const card = page.locator(`[flt-semantics-identifier="task-${proposalId}"]`);
      await expect(card).toBeVisible();
      await card.getByRole('button', { name: 'Approve', exact: true }).click();
      await expect.poll(async () => {
        const tasks = await page.evaluate(async () => {
          const response = await fetch('/api/tasks?limit=100', { cache: 'no-store' });
          if (!response.ok) throw new Error(`Task list returned ${response.status}`);
          return response.json();
        });
        return tasks.find((task: { id: string }) => task.id === proposalId)?.status;
      }, { timeout: 30_000 }).toBe('approved');
    });

    const completed = await allure.step('Then the isolated worker completes the queued task', async () => {
      let latest: any;
      await expect.poll(async () => {
        const tasks = await page.evaluate(async () => {
          const response = await fetch('/api/tasks?limit=100', { cache: 'no-store' });
          if (!response.ok) throw new Error(`Task list returned ${response.status}`);
          return response.json();
        });
        latest = tasks.find((task: { id: string }) => task.id === proposalId);
        if (!latest) throw new Error(`Task ${proposalId} disappeared from the owner list`);
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
      const card = page.locator(`[flt-semantics-identifier="task-${proposalId}"]`);
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
      }, proposalId);
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
    if (proposalId && !terminal) {
      try {
        await page.evaluate(async (id) => {
          await fetch(`/api/tasks/${id}/cancel`, { method: 'POST' });
        }, proposalId);
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
