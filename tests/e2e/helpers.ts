import { expect, type Locator, type Page } from '@playwright/test';

export const EMPLOYEE = { email: 'employee@spaceflow.local', password: 'Password123!' };
export const ADMIN = { email: 'admin@spaceflow.local', password: 'Admin123!' };
/**
 * Separate seeded employees per spec file. The test database is seeded once per run and every
 * booking counts toward the policy's "max 10 active reservations", so sharing one account across
 * all booking specs makes later tests fail on that (correct) policy check.
 */
export const MAP_EMPLOYEE = { email: 'arjun.mehta@spaceflow.local', password: 'Password123!' };
export const MOBILE_EMPLOYEE = { email: 'neha.iyer@spaceflow.local', password: 'Password123!' };
export const BUILDING_TZ = 'Asia/Kolkata';

/** Signs in through the API (sets the HttpOnly refresh cookie in this context), then opens `path`. */
export async function loginAs(page: Page, user: { email: string; password: string }, path = '/') {
  const res = await page.request.post('/api/v1/auth/login', { data: user });
  expect(res.ok(), `login ${user.email}: ${res.status()}`).toBeTruthy();
  await page.goto(path);
  await expect(page.getByTestId('user-menu')).toBeVisible();
}

/** Starts a guest sandbox through the API, then opens `path`. */
export async function loginAsGuest(page: Page, path = '/') {
  const res = await page.request.post('/api/v1/auth/guest', { headers: { 'X-Requested-With': 'SpaceFlow' } });
  expect(res.ok(), `guest login: ${res.status()}`).toBeTruthy();
  await page.goto(path);
  await expect(page.getByTestId('guest-banner')).toBeVisible();
}

/** The Nth business day after today (YYYY-MM-DD in the building time zone). */
export function businessDay(n: number): string {
  const parts = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: BUILDING_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const d = new Date(`${parts(new Date())}T12:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

/** Like businessDay(n) but never a Friday, so "later this week" options exist for desk bookings. */
export function midweekBusinessDay(n: number): string {
  let k = n;
  let d = businessDay(k);
  while (new Date(`${d}T12:00:00Z`).getUTCDay() === 5) d = businessDay(++k);
  return d;
}

export function daysAhead(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Types a date into an MUI X DatePicker field (accessible DOM structure, MM/DD/YYYY).
 * `scope` narrows the search when several "Date" pickers exist (e.g. inside a dialog).
 */
export async function setPickerDate(page: Page, isoDate: string, scope: Page | Locator = page, label = 'Date') {
  const [y, m, d] = isoDate.split('-');
  const group = scope.getByRole('group', { name: label }).first();
  await group.getByRole('spinbutton', { name: 'Month' }).click();
  await page.keyboard.type(`${m}${d}${y}`);
  await expect(group.getByRole('spinbutton', { name: 'Year' })).toHaveText(y);
}

/** Chooses an option from an MUI Select identified by its accessible label. */
export async function selectOption(page: Page, label: string, option: string | RegExp) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).first().click();
}

/** Opens the explorer in the keyboard-accessible list view for a given date (and optional floor). */
export async function openExplorerList(page: Page, date: string, opts: { floor?: RegExp; type?: 'Desks' | 'Rooms'; from?: string; to?: string } = {}) {
  await page.goto('/explore');
  await page.getByTestId('explore-view-list').click();
  await expect(page.getByTestId('resource-list')).toBeVisible();
  await setPickerDate(page, date);
  if (opts.from && opts.to) {
    await page.getByRole('checkbox', { name: 'Full day' }).uncheck();
    await selectOption(page, 'From', opts.from);
    await selectOption(page, 'To', opts.to);
  }
  if (opts.floor) await page.getByRole('radio', { name: opts.floor }).click();
  await page.getByRole('button', { name: 'Available only' }).click();
  if (opts.type) await page.getByRole('button', { name: opts.type, exact: true }).click();
  const firstRow = page.locator('[data-testid^="resource-row-"]').first();
  await expect(firstRow).toBeVisible();
  return firstRow;
}

/** Books whatever is selected in the details panel and returns to the success step. */
export async function bookSelected(page: Page, opts: { title?: string } = {}) {
  await expect(page.getByTestId('resource-details').first()).toBeVisible();
  await page.getByTestId('book-now').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  if (opts.title) await dialog.getByTestId('booking-title').fill(opts.title);
  await dialog.getByTestId('booking-continue').click();
  await dialog.getByTestId('booking-confirm').click();
  await expect(dialog.getByRole('heading', { name: /Booking confirmed/ })).toBeVisible();
  return dialog;
}
