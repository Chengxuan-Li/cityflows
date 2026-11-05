import { expect, test } from '@playwright/test';
import { button, pageErrors } from './helpers';

test('QA production Pages build loads and plays with no test API or requests outside /cityflows/', async ({
  page,
  baseURL,
}) => {
  const errors = pageErrors(page);
  const requests: string[] = [];
  const failed: string[] = [];
  page.context().on('request', (request) => requests.push(request.url()));
  page.context().on('requestfailed', (request) => failed.push(request.url()));
  page.context().on('response', (response) => {
    if (response.status() >= 400) failed.push(response.url());
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: '5 × 5 grid', exact: true })).toBeVisible();
  await expect(button(page, 'Play')).toBeEnabled();
  expect(await page.evaluate(() => window.cityflows)).toBeUndefined();
  const clock = page.getByLabel('Simulation clock', { exact: true });
  const start = await clock.innerText();
  await button(page, 'Play').click();
  await expect(clock).not.toHaveText(start);
  await button(page, 'Pause').click();
  await expect(button(page, 'Step')).toBeEnabled();
  expect(requests.some((url) => /worker.*\.js/.test(url))).toBe(true);
  const origin = new URL(baseURL!).origin;
  expect(
    requests.filter((url) => {
      const request = new URL(url);
      return request.origin !== origin || !request.pathname.startsWith('/cityflows/');
    }),
  ).toEqual([]);
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
});
