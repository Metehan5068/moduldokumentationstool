import { expect, type Page } from '@playwright/test';

/** Open a module as a user would before interacting with its lecture list. */
export async function expandModule(page: Page, name = 'ids') {
  const toggle = page.getByRole('region', { name: `Modul ${name}`, exact: true }).getByRole('button', { name, exact: true });
  await expect(toggle).toBeVisible();
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}
