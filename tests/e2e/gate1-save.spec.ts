import { expect, test, type Page } from '@playwright/test';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function pickCenterNode(page: Page) {
  const map = page.getByLabel('City map');
  const bounds = (await map.boundingBox())!;
  await map.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
  await expect(page.getByLabel('Phase 1 green (s)')).toBeVisible();
}

test('an edited network survives save and reopen (Gate 1 item 7)', async ({ page }) => {
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await pickCenterNode(page);
  const phase = page.getByLabel('Phase 1 green (s)');
  await expect(phase).toHaveValue('25');
  await phase.fill('5');
  await phase.press('Enter');
  await expect(page.getByText('Restart to apply changes', { exact: true })).toBeVisible();
  await expect(page.getByText('Cycle 96 s', { exact: false })).toBeVisible();

  const downloading = page.waitForEvent('download');
  await button(page, 'Save').click();
  const download = await downloading;

  await button(page, 'New').click();
  await expect(button(page, 'Play')).toBeEnabled();
  await pickCenterNode(page);
  await expect(phase).toHaveValue('25');

  await page.getByLabel('Open project').setInputFiles((await download.path())!);
  await expect(button(page, 'Play')).toBeEnabled();
  await pickCenterNode(page);
  await expect(phase).toHaveValue('5');
  await expect(page.getByText('Cycle 96 s', { exact: false })).toBeVisible();
  await expect(button(page, 'Undo')).toBeDisabled();
});
