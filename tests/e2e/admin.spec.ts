// Admin flows run as a guest: the guest is ORG_ADMIN of a private sandbox, so these tests never
// modify the seeded organisation and can run repeatedly.
import { expect, test } from '@playwright/test';
import { loginAsGuest, selectOption } from './helpers';

test.describe('admin portal', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsGuest(page, '/admin');
  });

  test('overview shows real figures', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(/seats|desks/i).first()).toBeVisible();
  });

  test('creates a building and a floor', async ({ page }) => {
    const code = `E2E${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const name = `E2E Annex ${code}`;
    await page.goto('/admin/buildings');
    await page.getByTestId('admin-create-building').click();
    const dialog = page.getByRole('dialog', { name: 'New building' });
    await dialog.getByRole('textbox', { name: /^Name/ }).fill(name);
    await dialog.getByRole('textbox', { name: /^Code/ }).fill(code);
    await dialog.getByTestId('building-save').click();
    await expect(dialog).toBeHidden();
    await page.getByRole('list', { name: 'Buildings' }).getByText(name).click();
    await expect(page).toHaveURL(/\/admin\/buildings\/[0-9a-f-]{36}$/);

    await page.getByTestId('admin-create-floor').click();
    const floorDialog = page.getByRole('dialog', { name: 'Add floor' });
    await floorDialog.getByTestId('floor-name').fill('Level 7');
    await floorDialog.getByLabel('Level number').fill('7');
    await floorDialog.getByTestId('floor-save').click();
    await expect(floorDialog).toBeHidden();
    await expect(page.getByTestId('admin-floor-7')).toContainText('Level 7');
  });

  test('creates a seat', async ({ page }) => {
    const code = `HT1-E${Date.now().toString(36).slice(-3).toUpperCase()}`;
    await page.goto('/admin/seats');
    await page.getByTestId('admin-create-seat').click();
    const dialog = page.getByRole('dialog', { name: 'New seat' });
    await selectOption(page, 'Building', 'Harbor Tower');
    await selectOption(page, 'Floor', /Level 1/);
    await dialog.getByTestId('resource-code').fill(code);
    await dialog.getByTestId('resource-name').fill(`Desk ${code}`);
    await dialog.getByTestId('resource-save').click();
    await expect(dialog).toBeHidden();
    await page.getByLabel('Search code or name').fill(code);
    await expect(page.getByTestId('admin-seats-table').getByText(code).first()).toBeVisible();
  });

  test('Map Studio saves and publishes a floor plan', async ({ page }) => {
    await page.goto('/admin/map-studio');
    await expect(page).toHaveURL(/\/admin\/map-studio\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('admin-save-plan')).toBeVisible();
    await page.getByRole('tab', { name: 'Add' }).click();
    await page.getByTestId('palette-PRINTER').click();
    await expect(page.getByTestId('admin-save-plan')).toBeEnabled();
    await page.getByTestId('admin-save-plan').click();
    await expect(page.getByText('Floor plan draft saved')).toBeVisible();
    await page.getByTestId('admin-publish-plan').click();
    await expect(page.getByText('Floor plan published')).toBeVisible();
  });
});
