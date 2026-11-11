import { expect, test, type Page } from '@playwright/test';
import { compile } from '../../src/network';
import type { City } from '../../src/schema';
import { pageErrors } from './helpers';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const city = (page: Page) => page.evaluate(() => window.cityflows!.city!()) as Promise<City>;
const groups = async (page: Page) => Object.values((await city(page)).junctionGroups ?? {});

/** The signalised node at the grid's centre, selected in the inspector. */
async function selectCentre(page: Page) {
  const map = page.getByLabel('City map');
  const box = (await map.boundingBox())!;
  await map.click({ position: { x: box.width / 2, y: box.height / 2 } });
  const heading = page.getByRole('heading', { name: /^Signal n:\d+$/ });
  await expect(heading).toBeVisible();
  return (await heading.textContent())!.replace('Signal ', '');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
});

test('T68 junction group: inspector, group program edits every member, join and leave undo', async ({
  page,
}, info) => {
  const errors = pageErrors(page);
  const centre = await selectCentre(page);
  expect(await groups(page)).toEqual([]);

  // Join the centre with its first neighbour: one signalised group, shown by the inspector.
  const neighbour = await page.getByLabel('Junction to join').inputValue();
  await button(page, 'Join junction').click();
  await expect(page.getByLabel('Junction group')).toContainText(centre);
  await expect(page.getByLabel('Junction group')).toContainText(neighbour);
  const [group] = await groups(page);
  expect(group!.nodes).toEqual([centre, neighbour].sort());
  expect(group!.signal).not.toBeNull();
  await page.screenshot({ path: info.outputPath('t68-group-inspector.png') });

  // The group's program in the signal editor: a longer first phase reaches every member.
  await page.getByText('Signal phases', { exact: true }).click();
  const green = page.getByLabel('Phase 1 green (s)');
  await expect(green).toBeVisible();
  const before = group!.signal!.phases[0]!.durationS;
  await green.fill(String(before + 7));
  await green.press('Enter');
  await button(page, 'Apply signal program').click();
  await expect
    .poll(async () => (await groups(page))[0]?.signal?.phases[0]?.durationS)
    .toBe(before + 7);
  const edited = await city(page);
  const compiled = compile(edited);
  expect(compiled.ok).toBe(true);
  if (!compiled.ok) return;
  const program = edited.junctionGroups![group!.id]!.signal!;
  const cycle = program.phases.reduce(
    (s, p) => s + p.durationS + program.amberS + program.allRedS,
    0,
  );
  for (const id of group!.nodes) {
    const node = compiled.compiled.nodes[compiled.compiled.index.node.get(id)!]!;
    expect(edited.nodes[id]!.control).toBe('signal');
    expect(edited.nodes[id]!.signal).toBeNull();
    // Each member runs the group's phases in lockstep: same phase count and cycle.
    expect(node.signal!.phases.map((p) => p.durationS)).toEqual(
      program.phases.map((p) => p.durationS),
    );
    expect(
      node.signal!.phases.reduce((s, p) => s + p.durationS + program.amberS + program.allRedS, 0),
    ).toBe(cycle);
  }
  await page.screenshot({ path: info.outputPath('t68-group-program.png') });

  // Undo the program edit, then the join: the city is as it was.
  await button(page, 'Undo').click();
  await expect.poll(async () => (await groups(page))[0]?.signal?.phases[0]?.durationS).toBe(before);
  await button(page, 'Undo').click();
  await expect.poll(async () => (await groups(page)).length).toBe(0);
  expect((await city(page)).nodes[centre]!.signal).not.toBeNull();

  // Redo the join, then leave: the two-node group dissolves; undo brings it back.
  await button(page, 'Redo').click();
  await expect.poll(async () => (await groups(page)).length).toBe(1);
  await expect(button(page, 'Leave junction group')).toBeVisible();
  await button(page, 'Leave junction group').click();
  await expect.poll(async () => (await groups(page)).length).toBe(0);
  await expect(page.getByLabel('Junction group')).toBeHidden();
  await button(page, 'Undo').click();
  await expect.poll(async () => (await groups(page)).length).toBe(1);
  expect((await groups(page))[0]!.nodes).toEqual([centre, neighbour].sort());
  expect(errors).toEqual([]);
});
