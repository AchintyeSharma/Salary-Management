import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RaiseCostPreviewPage } from './RaiseCostPreviewPage';

function renderPreviewPage(initialEntry = '/preview') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <RaiseCostPreviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RaiseCostPreviewPage validation, preview display, and directory link', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validates invalid percentage locally and displays preview figures with matching directory link', async () => {
    const user = userEvent.setup();

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === '/api/lookups') {
        return new Response(
          JSON.stringify({
            countries: [{ code: 'IN', name: 'India', currencyCode: 'INR' }],
            departments: [{ code: 'ENG', name: 'Engineering' }],
            levels: [{ code: 'L4', name: 'L4 - Staff' }],
            revisionReasons: [],
            fxSnapshot: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url === '/api/reports/raise-cost-preview' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            filters: { country: 'IN', department: 'ENG', status: 'active' },
            raisePercent: '5',
            headcount: 10,
            currency: 'INR',
            conversionApplied: false,
            fxBasis: null,
            currentAnnualSpend: '40000000.00',
            projectedAnnualSpend: '42000000.00',
            differenceAnnualSpend: '2000000.00',
            directoryPath: '/employees?country=IN&department=ENG&status=active',
            definitions: {
              population: 'Fixed to active employees.',
              calculation: 'Native rounding half-up.',
              currencyBasis: 'Native INR annual base pay.',
              readOnly: 'Zero writes.',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(null, { status: 404 });
    });

    renderPreviewPage();

    const pctInput = screen.getByLabelText(/Raise Percentage/i);
    await user.clear(pctInput);
    await user.type(pctInput, '0');
    await user.click(screen.getByRole('button', { name: /Preview Raise Cost/i }));
    expect(await screen.findByText(/must be greater than zero/i)).toBeInTheDocument();

    await user.clear(pctInput);
    await user.type(pctInput, '5');
    await user.click(screen.getByRole('button', { name: /Preview Raise Cost/i }));

    expect(await screen.findByTestId('preview-current-spend')).toHaveTextContent(
      'INR 40,000,000.00',
    );
    expect(screen.getByTestId('preview-projected-spend')).toHaveTextContent('INR 42,000,000.00');
    expect(screen.getByTestId('preview-difference')).toHaveTextContent('+INR 2,000,000.00');
    expect(screen.getByRole('link', { name: /Open matching employees/i })).toHaveAttribute(
      'href',
      '/employees?country=IN&department=ENG&status=active',
    );
  });
});
