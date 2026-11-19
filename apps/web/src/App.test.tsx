import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('HR Sign-In and Directory UI', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('shows sign-in when unauthenticated and navigates to directory after sign-in', async () => {
    const user = userEvent.setup();
    let signedIn = false;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === '/api/session' && (!init?.method || init.method === 'GET')) {
        if (!signedIn) {
          return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({
            account: { id: 1, email: 'hr@acme.example', displayName: 'ACME HR Manager' },
            expiresAt: '2026-11-18T12:00:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url === '/api/session' && init?.method === 'POST') {
        signedIn = true;
        return new Response(
          JSON.stringify({
            account: { id: 1, email: 'hr@acme.example', displayName: 'ACME HR Manager' },
            expiresAt: '2026-11-18T12:00:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url === '/api/lookups') {
        return new Response(
          JSON.stringify({
            countries: [{ code: 'IN', name: 'India', currencyCode: 'INR' }],
            departments: [{ code: 'ENG', name: 'Engineering' }],
            levels: [{ code: 'L4', name: 'L4 - Staff' }],
            revisionReasons: [{ code: 'MERIT', name: 'Merit Increase' }],
            fxSnapshot: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.startsWith('/api/employees')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 1,
                employeeNumber: 'EMP-00001',
                displayName: 'Priya Sharma',
                countryCode: 'IN',
                departmentCode: 'ENG',
                levelCode: 'L4',
                active: true,
                salaryCurrency: 'INR',
                currentSalary: '3600000.00',
                version: 3,
              },
            ],
            pagination: { page: 1, pageSize: 25, totalCount: 1, totalPages: 1 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(null, { status: 404 });
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: /ACME Salary Management/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/HR Email/i), 'hr@acme.example');
    await user.type(screen.getByLabelText(/Password/i), 'super-secret-pass');
    await user.click(screen.getByRole('button', { name: /Sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Employee Directory/i })).toBeInTheDocument();
    });
    expect(await screen.findByText('Priya Sharma')).toBeInTheDocument();
    expect(screen.getByText('INR 3,600,000.00')).toBeInTheDocument();
  });
});
