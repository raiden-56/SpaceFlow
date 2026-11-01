import { describe, expect, it, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, mockFetch } from '@/test/render';
import { NotificationsPage } from '../NotificationsPage';

afterEach(() => vi.unstubAllGlobals());

describe('NotificationsPage', () => {
  it('renders the empty state when there are no notifications', async () => {
    mockFetch({ '/users/me/notifications': { items: [], page: 1, pageSize: 20, total: 0, totalPages: 1, unread: 0 } });
    renderWithProviders(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText('No notifications yet')).toBeInTheDocument());
  });

  it('renders unread notifications with their titles', async () => {
    mockFetch({
      '/users/me/notifications': {
        items: [{ id: 'n1', type: 'BOOKING_CONFIRMED', title: 'Seat booked: Desk HT1-001', body: 'Harbor Tower', data: { reservationId: 'r1' }, readAt: null, createdAt: new Date().toISOString() }],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        unread: 1,
      },
    });
    renderWithProviders(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText('Seat booked: Desk HT1-001')).toBeInTheDocument());
    expect(screen.getByText('1 unread')).toBeInTheDocument();
  });
});
