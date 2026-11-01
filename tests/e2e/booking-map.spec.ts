// Navigation persistence (user-reported regression) and the booking-from-map UX.
import { expect, test, type Page } from '@playwright/test';
import { MAP_EMPLOYEE, businessDay, loginAs, midweekBusinessDay, setPickerDate } from './helpers';

/** A free desk/room on the 2D plan (role=button with "<name>, Available" label). */
function freeOnPlan(page: Page, kind: 'desk' | 'room') {
  const plan = page.getByTestId('floor-plan-2d');
  return kind === 'desk'
    ? plan.getByRole('button', { name: /^Desk [A-Z0-9-]+, Available(?!.*does not match)/ }).first()
    : plan.getByRole('button', { name: /^(?!Desk )[^,]+, Available(?!.*does not match)/ }).first();
}

test.describe('navigation', () => {
  test('the sidebar stays mounted while moving between pages', async ({ page }) => {
    await loginAs(page, MAP_EMPLOYEE);
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible();
    // Tag the live DOM node; if the layout re-mounts, the tag disappears.
    await sidebar.evaluate((el) => el.setAttribute('data-e2e-persist', 'yes'));
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await nav.getByRole('button', { name: 'Book a Seat' }).click();
    await expect(page).toHaveURL(/\/book-seat$/);
    await nav.getByRole('button', { name: 'My Bookings' }).click();
    await expect(page).toHaveURL(/\/bookings$/);
    await nav.getByRole('button', { name: 'Meeting Rooms' }).click();
    await expect(page).toHaveURL(/\/meeting-rooms$/);
    await expect(page.locator('aside[data-e2e-persist="yes"]')).toHaveCount(1);
  });
});

test.describe('booking from the floor map', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, MAP_EMPLOYEE);
  });

  test('Book a Seat: pick a desk on the map, use presets, see the location preview and book', async ({ page }) => {
    await page.goto('/book-seat');
    await setPickerDate(page, midweekBusinessDay(15));
    // Quick date/time chips exist on the criteria bar.
    await expect(page.getByRole('group', { name: 'Quick date and time' }).getByRole('button', { name: 'Morning' })).toBeVisible();

    await page.getByTestId('seat-view-map').click();
    const picker = page.getByTestId('floor-map-picker');
    await expect(picker).toBeVisible();
    await picker.getByRole('radio', { name: /Level 1/ }).click();
    await expect(picker.getByRole('radio', { name: /Level 1/ })).toHaveAttribute('aria-checked', 'true');

    const desk = freeOnPlan(page, 'desk');
    const label = (await desk.getAttribute('aria-label'))!;
    const code = /Desk ([A-Z0-9-]+),/.exec(label)![1];
    await desk.click();
    const details = page.getByTestId('resource-details').first();
    await expect(details).toContainText(code);
    await details.getByTestId('book-now').click();

    const dialog = page.getByRole('dialog');
    const presets = dialog.getByRole('group', { name: 'Quick time presets' });
    await presets.getByRole('button', { name: /Morning/ }).click();
    await expect(presets.getByRole('button', { name: /Morning/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByTestId('booking-rest-of-week')).toBeVisible();
    await dialog.getByTestId('booking-continue').click();
    await expect(dialog.getByTestId('booking-location-preview')).toBeVisible();
    await dialog.getByTestId('booking-confirm').click();
    await expect(dialog.getByRole('heading', { name: /Booking confirmed/ })).toBeVisible();
    await dialog.getByRole('button', { name: 'View booking' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(code);
  });

  test('Meeting Rooms: pick a room on the map and book it from the side panel', async ({ page }) => {
    await page.goto('/meeting-rooms');
    await setPickerDate(page, businessDay(16));
    await page.getByTestId('rooms-pick-on-map').click();
    const picker = page.getByTestId('floor-map-picker');
    await expect(picker).toBeVisible();
    await picker.getByRole('radio', { name: /Level 1/ }).click();
    const room = freeOnPlan(page, 'room');
    const name = (await room.getAttribute('aria-label'))!.split(',')[0];
    await room.click();
    const details = page.getByTestId('resource-details').first();
    await expect(details).toContainText(name);
    await details.getByTestId('book-now').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByTestId('booking-title').fill('Map-picked sync');
    await dialog.getByTestId('booking-continue').click();
    await dialog.getByTestId('booking-confirm').click();
    await expect(dialog.getByRole('heading', { name: /Booking confirmed/ })).toBeVisible();
  });

  test('the map view toggle is also available from the results toolbar', async ({ page }) => {
    await page.goto('/meeting-rooms');
    await page.getByTestId('rooms-view-map').click();
    await expect(page.getByTestId('floor-map-picker')).toBeVisible();
    await page.goto('/book-seat');
    await page.getByTestId('seat-view-cards').click();
    await expect(page.getByTestId('seat-results')).toBeVisible();
  });
});
