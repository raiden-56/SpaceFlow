import { describe, expect, it, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, mockFetch } from '@/test/render';
import { MyBookingsPage } from '../MyBookingsPage';

const booking = {
  id: 'r1',
  resourceId: 'res1',
  resourceCode: 'HT1-001',
  resourceName: 'Desk HT1-001',
  resourceType: 'SEAT',
  type: 'SEAT',
  status: 'CONFIRMED',
  title: null,
  startAt: '2030-01-10T03:30:00.000Z',
  endAt: '2030-01-10T12:00:00.000Z',
  timezone: 'Asia/Kolkata',
  isAllDay: false,
  userId: 'u1',
  userDisplayName: 'Sam Taylor',
  buildingId: 'b1',
  buildingName: 'Harbor Tower',
  floorId: 'f1',
  floorName: 'Level 1',
  floorNumber: 1,
  zoneName: null,
  seriesId: null,
  checkedInAt: null,
  checkedOutAt: null,
  cancelledAt: null,
  cancelReason: null,
  createdAt: '2030-01-01T00:00:00.000Z',
  updatedAt: '2030-01-01T00:00:00.000Z',
};

afterEach(() => vi.unstubAllGlobals());

describe('MyBookingsPage', () => {
  it('renders the four tabs and lists bookings from the API', async () => {
    mockFetch({
      '/users/me/reservations': { items: [booking], page: 1, pageSize: 12, total: 1, totalPages: 1 },
      '/buildings': [],
    });
    renderWithProviders(<MyBookingsPage />);
    expect(screen.getByTestId('bookings-tab-upcoming')).toBeInTheDocument();
    expect(screen.getByTestId('bookings-tab-ongoing')).toBeInTheDocument();
    expect(screen.getByTestId('bookings-tab-past')).toBeInTheDocument();
    expect(screen.getByTestId('bookings-tab-cancelled')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('booking-card-HT1-001')).toBeInTheDocument());
    expect(screen.getByText('1 booking')).toBeInTheDocument();
  });

  it('shows an empty state when there are no bookings', async () => {
    mockFetch({ '/users/me/reservations': { items: [], page: 1, pageSize: 12, total: 0, totalPages: 1 }, '/buildings': [] });
    renderWithProviders(<MyBookingsPage />);
    await waitFor(() => expect(screen.getByText('No upcoming bookings')).toBeInTheDocument());
  });
});
