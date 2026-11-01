import { expect, test } from '@playwright/test';
import { EMPLOYEE, MOBILE_EMPLOYEE, bookSelected, businessDay, daysAhead, loginAs, openExplorerList, setPickerDate } from './helpers';

test.describe('employee booking flows', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, EMPLOYEE);
  });

  test('floor navigation and the 2D / list views', async ({ page }) => {
    await page.goto('/explore');
    await page.getByTestId('explore-view-2d').click();
    await expect(page.getByTestId('floor-plan-2d')).toBeVisible();
    await page.getByRole('radio', { name: /Level 2/ }).click();
    await expect(page.getByRole('radio', { name: /Level 2/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('status').filter({ hasText: /Level 2: \d+\/\d+ desks/ })).toBeVisible();
    // Resources on the 2D plan are keyboard-focusable buttons.
    const desk = page.getByTestId('floor-plan-2d').getByRole('button', { name: /Desk HT2-/ }).first();
    await desk.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('resource-details').first()).toContainText(/HT2-/);

    await page.getByTestId('explore-view-list').click();
    await expect(page.getByTestId('resource-list')).toBeVisible();
    await expect(page.locator('[data-testid^="resource-row-HT2-"]').first()).toBeVisible();
  });

  test('books a desk from the list, sees it in My Bookings, views it on the map and cancels it', async ({ page }) => {
    const date = businessDay(10);
    const row = await openExplorerList(page, date, { floor: /Level 1/, type: 'Desks' });
    const code = (await row.getAttribute('data-testid'))!.replace('resource-row-', '');
    await row.click();
    const dialog = await bookSelected(page);

    // Success step -> booking details.
    await dialog.getByRole('button', { name: 'View booking' }).click();
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(code);
    await expect(page.getByText('Confirmed').first()).toBeVisible();
    await expect(page.getByRole('img', { name: /QR code for check-in/ })).toBeVisible();

    // My Bookings: upcoming tab lists it.
    await page.goto('/bookings');
    await page.getByTestId('bookings-tab-upcoming').click();
    const card = page.getByTestId(`booking-card-${code}`).first();
    await expect(card).toBeVisible();

    // View on map focuses the explorer on the booked desk.
    await card.getByRole('button', { name: 'View on map' }).click();
    await expect(page).toHaveURL(/\/explore$/);
    await expect(page.getByTestId('resource-details').first()).toContainText(code);

    // Cancel from the booking details page; the record stays with a cancelled status.
    await page.goto('/bookings');
    await page.getByTestId(`booking-card-${code}`).first().getByRole('button', { name: 'View details' }).click();
    await page.getByTestId('booking-cancel').click();
    const confirm = page.getByRole('dialog', { name: 'Cancel this booking?' });
    await confirm.getByLabel('Reason (optional)').fill('E2E test');
    await confirm.getByRole('button', { name: 'Cancel booking' }).click();
    await expect(page.getByText('Cancelled').first()).toBeVisible();
    await page.goto('/bookings');
    await page.getByTestId('bookings-tab-cancelled').click();
    await expect(page.getByTestId(`booking-card-${code}`).first()).toBeVisible();
  });

  test('books a meeting room with a title', async ({ page }) => {
    const date = businessDay(11);
    const row = await openExplorerList(page, date, { floor: /Level 1/, type: 'Rooms', from: '10:00', to: '11:00' });
    await row.click();
    const dialog = await bookSelected(page, { title: 'E2E planning' });
    await dialog.getByRole('button', { name: 'View booking' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E planning');
  });

  test('the backend rejects a booking beyond the 30-day advance window', async ({ page }) => {
    const far = daysAhead(45);
    const row = await openExplorerList(page, far, { floor: /Level 1/, type: 'Desks' });
    await row.click();
    await page.getByTestId('book-now').first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByTestId('booking-continue').click();
    await dialog.getByTestId('booking-confirm').click();
    await expect(dialog.getByRole('alert')).toContainText('at most 30 days in advance');
  });

  test('the booking dialog date can be changed before confirming', async ({ page }) => {
    const row = await openExplorerList(page, businessDay(13), { floor: /Level 2/, type: 'Desks' });
    await row.click();
    await page.getByTestId('book-now').first().click();
    const dialog = page.getByRole('dialog');
    await setPickerDate(page, businessDay(14), dialog);
    await dialog.getByTestId('booking-continue').click();
    await expect(dialog.getByText(/Summary/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Back' }).click();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });
});

test.describe('mobile', () => {
  test('books a desk on a phone @mobile', async ({ page }) => {
    await loginAs(page, MOBILE_EMPLOYEE);
    const row = await openExplorerList(page, businessDay(12), { type: 'Desks' });
    await row.click();
    // On mobile the details open in a bottom drawer.
    await bookSelected(page);
    await page.getByRole('dialog').getByRole('button', { name: 'View booking' }).click();
    await expect(page).toHaveURL(/\/bookings\//);
    // Bottom navigation is the primary navigation on phones.
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Bookings' }).click();
    await expect(page).toHaveURL(/\/bookings$/);
  });
});
