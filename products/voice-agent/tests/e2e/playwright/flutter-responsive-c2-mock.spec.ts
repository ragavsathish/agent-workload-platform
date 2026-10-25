import * as allure from 'allure-js-commons';
import { test, expect, enableFlutterSemantics } from './fixtures';
import { expectCleanFlutterBrowser } from './flutter-browser';
import { captureResponsiveLayout, responsiveViewports } from './responsive-layout';

async function expectOnScreen(locator, viewport) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

test('Flutter voice home, conversation, and task dialog fit mobile, tablet, and desktop', async ({
  page, browserEvidence,
}, testInfo) => {
  for (const viewport of responsiveViewports) {
    await allure.step(`Given Flutter voice home opens at ${viewport.name} resolution`, async () => {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'networkidle' });
      await enableFlutterSemantics(page);
      for (const name of ['Replays', viewport.width >= 900 ? 'System' : 'System health',
        'Chat', 'Knowledge', 'Start conversation']) {
        await expectOnScreen(page.getByRole('button', { name, exact: true }), viewport);
      }
      await captureResponsiveLayout(page, testInfo, 'flutter-voice-home', viewport);
    });

    const workspace = await allure.step(`When I open the Flutter conversation at ${viewport.name} resolution`, async () => {
      const popup = page.waitForEvent('popup');
      await page.getByRole('button', { name: 'Chat', exact: true }).click();
      const opened = await popup;
      await opened.setViewportSize(viewport);
      await opened.waitForLoadState('networkidle');
      await enableFlutterSemantics(opened);
      await expect(opened.getByRole('textbox', { name: 'Message Pi…' })).toBeVisible();
      await expectOnScreen(opened.getByRole('button', { name: viewport.width >= 840
        ? 'New task' : 'Show tasks', exact: true }), viewport);
      await captureResponsiveLayout(opened, testInfo, 'flutter-conversation', viewport);
      return opened;
    });

    await allure.step(`Then the task creation dialog fits ${viewport.name} resolution`, async () => {
      if (viewport.width < 840) {
        await workspace.getByRole('button', { name: 'Show tasks', exact: true }).click();
      }
      await workspace.getByRole('button', { name: 'New task', exact: true }).click();
      const dialog = workspace.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('Create durable task');
      await expectOnScreen(dialog.getByRole('button', { name: 'Create task' }), viewport);
      await expectOnScreen(dialog.getByRole('button', { name: 'Cancel' }), viewport);
      await captureResponsiveLayout(workspace, testInfo, 'flutter-task-dialog', viewport);
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await workspace.close();
    });
  }
  await allure.step('And the browser reports no unexpected errors', async () => {
    expectCleanFlutterBrowser(page, browserEvidence, 20);
  });
});
