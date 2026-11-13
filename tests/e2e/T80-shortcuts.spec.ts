import { expect, test, type Page } from '@playwright/test';
import { button, city, clickGrid, clockTimeS, pageErrors } from './helpers';

// TASK-168: ⌘ on a Mac, Ctrl elsewhere; the labels the app shows follow the same rule.
const apple = process.platform === 'darwin';
const mod = 'ControlOrMeta';
const shown = (others: string, mac: string) => (apple ? mac : others);

const key = (page: Page, name: string) => page.keyboard.press(name);
const roadCount = async (page: Page) => Object.keys((await city(page)).roads).length;
const commands = (page: Page) => page.getByRole('dialog', { name: 'Commands', exact: true });
const shortcuts = (page: Page) =>
  page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
const search = (page: Page) => page.getByRole('combobox', { name: 'Search commands' });

let errors: string[];

test.beforeEach(async ({ page }) => {
  errors = pageErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '5 × 5 grid' })).toBeVisible();
  await expect(button(page, 'Play')).toBeEnabled();
});

test.afterEach(() => expect(errors).toEqual([]));

test('Space plays and pauses, number keys switch tools, and a field keeps its keys', async ({
  page,
}) => {
  await key(page, 'Space');
  await expect(button(page, 'Pause')).toBeEnabled();
  await expect(button(page, 'Play')).toBeDisabled();
  await key(page, 'Space');
  await expect(button(page, 'Play')).toBeEnabled();

  await key(page, '2');
  await expect(button(page, 'Road')).toHaveAttribute('aria-pressed', 'true');
  await key(page, '5');
  await expect(button(page, 'Roundabout')).toHaveAttribute('aria-pressed', 'true');
  await key(page, '1');
  await expect(button(page, 'Select')).toHaveAttribute('aria-pressed', 'true');

  // The map's own Space gesture still pans: held with a drag, it does not play.
  const box = (await page.getByLabel('City map').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await expect(button(page, 'Play')).toBeEnabled();

  // In a select, the keys belong to the field.
  const speed = page.getByRole('combobox', { name: 'Speed', exact: true });
  await speed.focus();
  await key(page, '3');
  await key(page, ']');
  await expect(button(page, 'Select')).toHaveAttribute('aria-pressed', 'true');
  await expect(speed).toHaveValue('1');
});

test('Undo and Redo follow the keys, Escape clears the selection and Delete deletes the street', async ({
  page,
}) => {
  const roads = await roadCount(page);
  await expect(button(page, 'Undo')).toBeDisabled();
  await clickGrid(page, 60, 1.5);
  await expect(button(page, 'Delete street')).toBeVisible();
  await key(page, 'Escape');
  await expect(button(page, 'Delete street')).toBeHidden();

  await clickGrid(page, 60, 1.5);
  await key(page, 'Delete');
  await expect.poll(() => roadCount(page)).toBe(roads - 2);
  await expect(button(page, 'Undo')).toBeEnabled();
  await key(page, `${mod}+z`);
  await expect.poll(() => roadCount(page)).toBe(roads);
  await expect(button(page, 'Redo')).toBeEnabled();
  await key(page, `${mod}+Shift+z`);
  await expect.poll(() => roadCount(page)).toBe(roads - 2);
  await key(page, `${mod}+z`);
  await expect.poll(() => roadCount(page)).toBe(roads);
  await expect(button(page, 'Undo')).toBeDisabled();
});

test('the command menu searches, moves with the arrow keys, and runs a command', async ({
  page,
}) => {
  const start = await clockTimeS(page);
  await key(page, `${mod}+k`);
  await expect(commands(page)).toBeVisible();
  await expect(search(page)).toBeFocused();
  // Every command is listed with its key; one that cannot run now is dimmed.
  const options = commands(page).getByRole('option');
  await expect(options.filter({ hasText: 'Undo' })).toContainText(shown('Ctrl+Z', '⌘Z'));
  await expect(options.filter({ hasText: 'Undo' })).toHaveAttribute('aria-disabled', 'true');
  await expect(options.filter({ hasText: 'Export data' })).toContainText(
    shown('Ctrl+Shift+S', '⇧⌘S'),
  );

  await page.keyboard.type('step');
  await expect(options).toHaveCount(1);
  await key(page, 'Enter');
  await expect(commands(page)).toBeHidden();
  await expect.poll(() => clockTimeS(page)).toBeGreaterThan(start);

  // Step comes first; the arrow key moves to the next match, Restart, and Enter runs it.
  await key(page, `${mod}+k`);
  await page.keyboard.type('st');
  await expect(options.first()).toContainText('Step');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await expect(options.filter({ hasText: 'Restart' })).toBeVisible();
  await key(page, 'ArrowDown');
  await expect(commands(page).getByRole('option', { selected: true })).toContainText('Restart');
  await key(page, 'Enter');
  await expect(commands(page)).toBeHidden();
  await expect.poll(() => clockTimeS(page)).toBe(start);

  // A command that cannot run stays in the list and does nothing; the key toggles the menu.
  await key(page, `${mod}+k`);
  await page.keyboard.type('redo');
  await key(page, 'Enter');
  await expect(commands(page)).toBeVisible();
  await key(page, `${mod}+k`);
  await expect(commands(page)).toBeHidden();
  await key(page, `${mod}+k`);
  await key(page, 'Escape');
  await expect(commands(page)).toBeHidden();
  await expect(search(page)).toBeHidden();

  // Digits and ? typed into the search are text, not tool or help keys.
  await key(page, `${mod}+k`);
  await page.keyboard.type('?2');
  await expect(search(page)).toHaveValue('?2');
  await expect(shortcuts(page)).toBeHidden();
  await expect(options).toHaveCount(0);
  await expect(commands(page).getByText('No matching command')).toBeVisible();
  await key(page, 'Escape');
  await expect(button(page, 'Select')).toHaveAttribute('aria-pressed', 'true');

  // It also reaches the file picker and the other sheets.
  await key(page, `${mod}+k`);
  await page.keyboard.type('open');
  const chooser = page.waitForEvent('filechooser');
  await key(page, 'Enter');
  await chooser;
  await key(page, `${mod}+k`);
  await page.keyboard.type('new city');
  await key(page, 'Enter');
  await expect(page.getByRole('dialog', { name: 'New city', exact: true })).toBeVisible();
  await expect(commands(page)).toBeHidden();
});

test('the shortcut sheet opens on ? and the modifier with /, and lists every key', async ({
  page,
}) => {
  await key(page, '?');
  await expect(shortcuts(page)).toBeVisible();
  for (const label of [
    shown('Ctrl+N', '⌘N'),
    shown('Ctrl+Shift+S', '⇧⌘S'),
    shown('Ctrl+Shift+Z', '⇧⌘Z'),
    shown('Ctrl+K', '⌘K'),
    shown('Ctrl+1', '⌘1'),
    'Space',
    'Esc',
  ])
    await expect(shortcuts(page).locator('kbd', { hasText: label }).first()).toBeVisible();
  await key(page, 'Escape');
  await expect(shortcuts(page)).toBeHidden();

  await key(page, `${mod}+/`);
  await expect(shortcuts(page)).toBeVisible();
  await key(page, `${mod}+/`);
  await expect(shortcuts(page)).toBeHidden();

  // The two sheets replace each other, and a sheet keeps tool keys from firing behind it.
  await key(page, '?');
  await key(page, '2');
  await expect(button(page, 'Select')).toHaveAttribute('aria-pressed', 'true');
  await key(page, `${mod}+k`);
  await expect(commands(page)).toBeVisible();
  await expect(shortcuts(page)).toBeHidden();
});

test('the sidebar and inspector toggle on the keys, and tooltips and the overflow menu show them', async ({
  page,
}) => {
  await key(page, `${mod}+1`);
  await expect(button(page, 'Show sidebar')).toBeVisible();
  await key(page, `${mod}+1`);
  await expect(button(page, 'Hide sidebar')).toBeVisible();
  await key(page, `${mod}+2`);
  await expect(button(page, 'Show inspector')).toBeVisible();
  await key(page, `${mod}+2`);
  await expect(button(page, 'Hide inspector')).toBeVisible();

  await expect(button(page, 'Play')).toHaveAccessibleDescription('Run the simulation · Space');
  await expect(button(page, 'Undo')).toHaveAccessibleDescription(
    `Undo the last edit · ${shown('Ctrl+Z', '⌘Z')}`,
  );
  await expect(button(page, 'Road')).toHaveAccessibleDescription(
    'Draw a street · 2 · Enter finishes · Escape cancels',
  );

  await page.setViewportSize({ width: 450, height: 800 });
  await button(page, 'More toolbar items').click();
  const overflow = page.locator('.overflow-menu');
  await expect(overflow.getByRole('button', { name: 'Save', exact: true })).toContainText(
    shown('Ctrl+S', '⌘S'),
  );
  await expect(overflow.getByRole('button', { name: 'Restart', exact: true })).toContainText(
    shown('Ctrl+R', '⌘R'),
  );
  await expect(overflow.getByRole('button', { name: 'Undo', exact: true })).toContainText(
    shown('Ctrl+Z', '⌘Z'),
  );
});
