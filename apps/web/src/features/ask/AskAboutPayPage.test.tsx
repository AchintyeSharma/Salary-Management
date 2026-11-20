import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AskAboutPayPage } from './AskAboutPayPage';

function renderAskPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AskAboutPayPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AskAboutPayPage confirmation and clarification flows', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires confirmation before calling /api/reports/compensation and renders templated figures', async () => {
    const user = userEvent.setup();
    const reportCalls: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === '/api/pay-questions/interpret') {
        return new Response(
          JSON.stringify({
            mode: 'deterministic',
            outcome: 'report_intent',
            summary: 'Ready to run.',
            intent: {
              metric: 'median',
              filters: { country: 'IN', department: 'ENG', status: 'active' },
              expectedCurrency: 'INR',
              conversionExpected: false,
              label: 'Median annual base salary for active employees Engineering in India',
              dashboardPath: '/reports?country=IN&department=ENG&status=active',
              directoryPath: '/employees?country=IN&department=ENG&status=active',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.startsWith('/api/reports/compensation')) {
        reportCalls.push(url);
        return new Response(
          JSON.stringify({
            filters: { country: 'IN', department: 'ENG', status: 'active' },
            currency: 'INR',
            conversionApplied: false,
            fxBasis: null,
            summary: {
              headcount: 42,
              totalAnnualBaseSalary: '126000000.00',
              medianAnnualBaseSalary: '3000000.00',
            },
            groups: [],
            definitions: {
              population: 'Active employees.',
              totalAnnualBaseSalary: 'Sum.',
              median: 'Median.',
              currencyBasis: 'Native INR annual base pay.',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(null, { status: 404 });
    });

    renderAskPage();

    await user.type(
      screen.getByLabelText(/Compensation question/i),
      'What is the median annual base salary for Engineering in India?',
    );
    await user.click(screen.getByRole('button', { name: /Interpret/i }));

    expect(await screen.findByText(/Confirm Interpreted Report/i)).toBeInTheDocument();
    // Report endpoint MUST NOT have been called prior to confirmation
    expect(reportCalls).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /Confirm & Run Report/i }));

    expect(await screen.findByTestId('ask-answer-headline')).toHaveTextContent(
      'Median annual base salary: INR 3,000,000.00 across 42 employees.',
    );
    expect(reportCalls).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Open equivalent Dashboard view/i })).toHaveAttribute(
      'href',
      '/reports?country=IN&department=ENG&status=active',
    );
  });
});
