import { expect, test } from '@playwright/test';
import { EMPLOYEE, loginAs } from './helpers';

test.describe('authentication', () => {
  test('employee signs in through the login form and lands on the dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(EMPLOYEE.email);
    await page.getByTestId('login-password').fill(EMPLOYEE.password);
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('user-menu')).toBeVisible();
    await expect(page.getByTestId('dashboard-quick-book')).toBeVisible();
  });

  test('wrong password shows an error and stays on the login page', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(EMPLOYEE.email);
    await page.getByTestId('login-password').fill('not-the-password');
    await page.getByTestId('login-submit').click();
    await expect(page.getByRole('alert')).toContainText('Incorrect email or password');
    await expect(page).toHaveURL(/\/login/);
  });

  test('session survives a reload (silent refresh) and sign out ends it', async ({ page }) => {
    await loginAs(page, EMPLOYEE);
    await page.reload();
    await expect(page.getByTestId('user-menu')).toBeVisible();
    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/bookings');
    await expect(page).toHaveURL(/\/login/);
  });

  test('employees cannot open the admin portal', async ({ page }) => {
    await loginAs(page, EMPLOYEE);
    await page.goto('/admin');
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
    // The API enforces it too, independent of the UI.
    const res = await page.request.get('/api/v1/admin/users');
    expect(res.status()).toBe(401); // no bearer token on raw requests
  });
});

test.describe('guest mode', () => {
  test('"Continue as guest" opens a private sandbox with demo data', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('guest-login').click();
    await expect(page.getByTestId('guest-banner')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('dashboard-quick-book')).toBeVisible();
    // Demo data is present: the guest has favourites and buildings.
    await page.goto('/explore');
    await page.getByTestId('explore-view-list').click();
    await expect(page.locator('[data-testid^="resource-row-"]').first()).toBeVisible();
    // Guests are org admins of their sandbox, so the admin portal works too.
    await page.goto('/admin');
    await expect(page.getByText("You don't have access to this page")).toHaveCount(0);
    await expect(page.getByTestId('guest-banner')).toBeVisible();
  });
});
