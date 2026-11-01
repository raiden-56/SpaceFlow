import { describe, expect, it, vi, afterEach } from 'vitest';
import { screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminUserDto } from '@spaceflow/shared';
import { renderWithProviders, mockFetch } from '@/test/render';
import { AdminEmployeesPage } from '../AdminEmployeesPage';

afterEach(() => vi.unstubAllGlobals());

const jonas: AdminUserDto = {
  id: 'u2',
  email: 'jonas@example.com',
  firstName: 'Jonas',
  lastName: 'Brunner',
  displayName: 'Jonas Brunner',
  avatarUrl: null,
  jobTitle: 'Recruiter',
  departmentId: null,
  departmentName: null,
  teamId: null,
  teamName: null,
  roles: ['EMPLOYEE'],
  status: 'ACTIVE',
  homeBuildingId: null,
  homeBuildingName: null,
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('AdminEmployeesPage', () => {
  it('discards unsaved edits when the employee dialog is cancelled and reopened', async () => {
    mockFetch({
      '/admin/users': { items: [jonas], page: 1, pageSize: 20, total: 1, totalPages: 1 },
      '/admin/departments': [],
      '/buildings': [],
    });
    const user = userEvent.setup();
    renderWithProviders(<AdminEmployeesPage />);

    await user.click(await screen.findByText('Jonas Brunner'));
    const title = await screen.findByLabelText('Job title');
    await user.clear(title);
    await user.type(title, 'Head of Talent');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitForElementToBeRemoved(() => screen.queryByRole('dialog'));

    await user.click(screen.getByText('Jonas Brunner'));
    expect(await screen.findByRole('heading', { name: 'Edit Jonas Brunner' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Job title')).toHaveValue('Recruiter'));
  });
});
