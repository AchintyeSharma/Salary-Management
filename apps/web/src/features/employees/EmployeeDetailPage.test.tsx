import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmployeeDetailPage } from './EmployeeDetailPage';

function renderDetailPage(queryClient?: QueryClient) {
  const qc =
    queryClient ??
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  return {
    queryClient: qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/employees/1']}>
          <Routes>
            <Route path="/employees/:id" element={<EmployeeDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

describe('EmployeeDetailPage salary revision validation and conflict recovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validates unchanged salary locally and surfaces latest server data on 409 conflict', async () => {
    const user = userEvent.setup();
    let detailFetchCount = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();

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

      if (url === '/api/employees/1' && (!init?.method || init.method === 'GET')) {
        detailFetchCount += 1;
        return new Response(
          JSON.stringify({
            id: 1,
            employeeNumber: 'EMP-00001',
            displayName: 'Priya Sharma',
            countryCode: 'IN',
            departmentCode: 'ENG',
            levelCode: 'L4',
            active: true,
            salaryCurrency: 'INR',
            currentSalary: detailFetchCount === 1 ? '3600000.00' : '3750000.00',
            version: detailFetchCount === 1 ? 3 : 4,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2026-11-18T00:00:00.000Z',
            revisions: [
              {
                id: 10,
                sequence: 3,
                previousSalary: '3150000.00',
                newSalary: '3600000.00',
                currencyCode: 'INR',
                reasonCode: 'PROMOTION',
                actorDisplayName: 'Synthetic Seed System',
                recordedAt: '2026-07-01T00:00:00.000Z',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url === '/api/employees/1/salary-revisions' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            error: {
              code: 'VERSION_CONFLICT',
              message: 'This employee record was updated by another session.',
              details: {
                currentEmployee: {
                  id: 1,
                  employeeNumber: 'EMP-00001',
                  displayName: 'Priya Sharma',
                  countryCode: 'IN',
                  departmentCode: 'ENG',
                  levelCode: 'L4',
                  active: true,
                  salaryCurrency: 'INR',
                  currentSalary: '3750000.00',
                  version: 4,
                },
              },
            },
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(null, { status: 404 });
    });

    renderDetailPage();

    expect(await screen.findByText('Priya Sharma')).toBeInTheDocument();

    // Unchanged salary caught before confirmation modal opens
    const salaryInput = screen.getByLabelText(/New Annual Base Salary/i);
    await user.type(salaryInput, '3600000');
    await user.click(screen.getByRole('button', { name: /Review & Save Revision/i }));
    expect(await screen.findByText(/New salary must differ/i)).toBeInTheDocument();

    // Valid new salary opens confirm modal, triggers 409, shows latest data + reload button
    await user.clear(salaryInput);
    await user.type(salaryInput, '3900000');
    await user.click(screen.getByRole('button', { name: /Review & Save Revision/i }));
    await user.click(await screen.findByRole('button', { name: /Confirm & Save/i }));

    expect(await screen.findByText(/updated by another session/i)).toBeInTheDocument();
    expect(screen.getByText(/INR 3,750,000\.00.*Version 4/i)).toBeInTheDocument();

    const reloadBtn = await screen.findByRole('button', { name: /Reload latest/i });
    await user.click(reloadBtn);
    await waitFor(() => {
      expect(screen.getByText(/EMP-00001 · Version 4/)).toBeInTheDocument();
    });
  });

  it('freezes expectedVersion when dialog opens so background refetches cannot silently advance it', async () => {
    const user = userEvent.setup();
    let submittedPayload: any = null;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();

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

      if (url === '/api/employees/1' && (!init?.method || init.method === 'GET')) {
        return new Response(
          JSON.stringify({
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
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2026-11-18T00:00:00.000Z',
            revisions: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url === '/api/employees/1/salary-revisions' && init?.method === 'POST') {
        submittedPayload = JSON.parse(init.body as string);
        return new Response(
          JSON.stringify({
            error: {
              code: 'VERSION_CONFLICT',
              message: 'This employee record was updated by another session.',
              details: {
                currentEmployee: {
                  id: 1,
                  employeeNumber: 'EMP-00001',
                  displayName: 'Priya Sharma',
                  countryCode: 'IN',
                  departmentCode: 'ENG',
                  levelCode: 'L4',
                  active: true,
                  salaryCurrency: 'INR',
                  currentSalary: '3750000.00',
                  version: 4,
                },
              },
            },
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(null, { status: 404 });
    });

    const { queryClient } = renderDetailPage();

    expect(await screen.findByText('Priya Sharma')).toBeInTheDocument();
    const salaryInput = screen.getByLabelText(/New Annual Base Salary/i);
    await user.type(salaryInput, '3900000');
    await user.click(screen.getByRole('button', { name: /Review & Save Revision/i }));

    // Confirm dialog is open displaying reviewed numbers
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Confirm Salary Revision/i)).toBeInTheDocument();

    // Background cache update advances version in cache from 3 to 4
    queryClient.setQueryData(['employee', 1], (prev: any) => ({
      ...prev,
      version: 4,
      currentSalary: '3750000.00',
    }));

    // HR clicks Confirm & Save in the open dialog
    await user.click(screen.getByRole('button', { name: /Confirm & Save/i }));

    // Verify submitted expectedVersion was frozen at 3 (not 4)
    expect(submittedPayload).toBeDefined();
    expect(submittedPayload.expectedVersion).toBe(3);

    // 409 conflict received: dialog must close and surface latest server data
    expect(await screen.findByText(/updated by another session/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('preserves the exact same requestKey and payload on network retry', async () => {
    const user = userEvent.setup();
    const recordedPostBodies: any[] = [];
    let postCallCount = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();

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

      if (url === '/api/employees/1' && (!init?.method || init.method === 'GET')) {
        return new Response(
          JSON.stringify({
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
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2026-11-18T00:00:00.000Z',
            revisions: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url === '/api/employees/1/salary-revisions' && init?.method === 'POST') {
        postCallCount += 1;
        recordedPostBodies.push(JSON.parse(init.body as string));

        if (postCallCount === 1) {
          // Simulate transient network or server error on first attempt
          return new Response(
            JSON.stringify({
              error: {
                code: 'INTERNAL_ERROR',
                message: 'Temporary server error.',
              },
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          );
        }

        // Retry succeeds
        return new Response(
          JSON.stringify({
            employee: {
              id: 1,
              employeeNumber: 'EMP-00001',
              displayName: 'Priya Sharma',
              countryCode: 'IN',
              departmentCode: 'ENG',
              levelCode: 'L4',
              active: true,
              salaryCurrency: 'INR',
              currentSalary: '3900000.00',
              version: 4,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2026-11-19T00:00:00.000Z',
              revisions: [],
            },
            revision: {
              id: 99,
              sequence: 4,
              previousSalary: '3600000.00',
              newSalary: '3900000.00',
              currencyCode: 'INR',
              reasonCode: 'MERIT',
              actorDisplayName: 'ACME HR Manager',
              recordedAt: '2026-11-19T00:00:00.000Z',
            },
            replayed: false,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(null, { status: 404 });
    });

    renderDetailPage();

    expect(await screen.findByText('Priya Sharma')).toBeInTheDocument();
    const salaryInput = screen.getByLabelText(/New Annual Base Salary/i);
    await user.type(salaryInput, '3900000');
    await user.click(screen.getByRole('button', { name: /Review & Save Revision/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    // First attempt fails with 500 error
    await user.click(screen.getByRole('button', { name: /Confirm & Save/i }));
    const errorElements = await screen.findAllByText(/Temporary server error/i);
    expect(errorElements.length).toBeGreaterThanOrEqual(1);

    // Dialog remains open for retry
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Retry by clicking Confirm & Save again
    await user.click(screen.getByRole('button', { name: /Confirm & Save/i }));

    // Second attempt succeeds: dialog closes and success banner appears
    expect(await screen.findByText(/Saved salary revision #4/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Verify both attempts used identical payload and identical requestKey
    expect(recordedPostBodies).toHaveLength(2);
    expect(recordedPostBodies[0].expectedVersion).toBe(3);
    expect(recordedPostBodies[1].expectedVersion).toBe(3);
    expect(recordedPostBodies[0].newSalary).toBe('3900000');
    expect(recordedPostBodies[1].newSalary).toBe('3900000');
    expect(recordedPostBodies[0].reasonCode).toBe('MERIT');
    expect(recordedPostBodies[1].reasonCode).toBe('MERIT');
    expect(recordedPostBodies[0].requestKey).toBeTruthy();
    expect(recordedPostBodies[0].requestKey).toBe(recordedPostBodies[1].requestKey);
  });
});
