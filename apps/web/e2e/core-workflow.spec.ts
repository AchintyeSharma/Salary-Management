import { expect, test } from '@playwright/test';

const HR_EMAIL = process.env.HR_DEMO_EMAIL ?? 'hr.manager@acme.example';
const HR_PASSWORD = process.env.HR_DEMO_PASSWORD ?? 'acme-local-demo-pass';

function parseDisplayedAmountToMinor(displayed: string): bigint {
  // e.g. "INR 3,600,000.00" -> 360000000n
  const cleaned = displayed.replace(/^[A-Z]{3}\s+/, '').replace(/,/g, '').trim();
  const [whole = '0', frac = '00'] = cleaned.split('.');
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
}

function parseHeadcount(text: string): number {
  return Number(text.replace(/,/g, '').trim());
}

test('full core workflow on 10,000-employee seed', async ({ page }) => {
  // 1. Sign in
  await page.goto('/login');
  await page.getByLabel(/HR Email/i).fill(HR_EMAIL);
  await page.getByLabel(/Password/i).fill(HR_PASSWORD);
  await page.getByRole('button', { name: /Sign in/i }).click();

  await expect(page.getByRole('heading', { name: /Employee Directory/i })).toBeVisible();
  await expect(page.getByText(/matching employees/i)).toContainText('9,493');

  // 2. Find EMP-00001 (Priya Sharma) in the 10k directory and open detail
  await page.getByLabel(/Search name or employee #/i).fill('EMP-00001');
  await page.getByRole('button', { name: /^Search$/i }).click();

  const priyaRow = page.locator('tbody tr', { hasText: 'EMP-00001' });
  await expect(priyaRow).toBeVisible();
  await expect(priyaRow).toContainText('Priya Sharma');
  await priyaRow.getByRole('link', { name: /View/i }).click();

  await expect(page.getByRole('heading', { name: 'Priya Sharma' })).toBeVisible();
  const currentSalaryText = (
    await page.locator('h5').first().textContent()
  )?.trim() ?? '';
  const currentMinor = parseDisplayedAmountToMinor(currentSalaryText);
  const nextMinor = currentMinor + 5_000_000n; // +INR 50,000.00
  const nextMajorString = `${(nextMinor / 100n).toString()}.${(nextMinor % 100n).toString().padStart(2, '0')}`;

  const initialRevisionRows = await page.locator('table[aria-label="Salary revision history"] tbody tr').count();

  // 3. Revise salary, reload, and verify persistence + history
  await page.getByLabel(/New Annual Base Salary/i).fill(nextMajorString);
  await page.getByRole('button', { name: /Review & Save Revision/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: /Confirm & Save/i }).click();

  await expect(page.getByText(/Saved salary revision #/i)).toBeVisible();
  const detailUrl = page.url();

  // Reload page and confirm salary + revision history persisted in PostgreSQL
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Priya Sharma' })).toBeVisible();
  const reloadedSalaryText = (await page.locator('h5').first().textContent())?.trim() ?? '';
  expect(parseDisplayedAmountToMinor(reloadedSalaryText)).toBe(nextMinor);
  const afterRevisionRows = await page.locator('table[aria-label="Salary revision history"] tbody tr').count();
  expect(afterRevisionRows).toBe(initialRevisionRows + 1);

  // 4. Read active India + Engineering report BEFORE deactivation
  await page.goto('/reports?country=IN&department=ENG&status=active');
  const beforeHeadcount = parseHeadcount((await page.getByTestId('report-headcount').textContent()) ?? '0');
  const beforeTotalText = (await page.getByTestId('report-total').textContent())?.trim() ?? '';
  const beforeMedianText = (await page.getByTestId('report-median').textContent())?.trim() ?? '';
  const beforeTotalMinor = parseDisplayedAmountToMinor(beforeTotalText);
  expect(beforeHeadcount).toBeGreaterThan(100);

  // 5. Deactivate Priya Sharma and verify exclusion from active reports
  await page.goto(detailUrl);
  await page.getByRole('button', { name: /^Deactivate$/i }).click();
  await page.getByRole('button', { name: /Confirm Deactivate/i }).click();
  await expect(page.getByText(/Employee deactivated/i)).toBeVisible();

  await page.goto('/reports?country=IN&department=ENG&status=active');
  const duringHeadcount = parseHeadcount((await page.getByTestId('report-headcount').textContent()) ?? '0');
  const duringTotalText = (await page.getByTestId('report-total').textContent())?.trim() ?? '';
  expect(duringHeadcount).toBe(beforeHeadcount - 1);
  expect(parseDisplayedAmountToMinor(duringTotalText)).toBe(beforeTotalMinor - nextMinor);

  // 6. Reactivate Priya Sharma and verify inclusion & history restored
  await page.goto(detailUrl);
  await page.getByRole('button', { name: /^Reactivate$/i }).click();
  await page.getByRole('button', { name: /Confirm Reactivate/i }).click();
  await expect(page.getByText(/Employee reactivated/i)).toBeVisible();
  expect(
    await page.locator('table[aria-label="Salary revision history"] tbody tr').count(),
  ).toBe(afterRevisionRows);

  await page.goto('/reports?country=IN&department=ENG&status=active');
  const afterReactHeadcount = parseHeadcount((await page.getByTestId('report-headcount').textContent()) ?? '0');
  const afterReactTotalText = (await page.getByTestId('report-total').textContent())?.trim() ?? '';
  const afterReactMedianText = (await page.getByTestId('report-median').textContent())?.trim() ?? '';
  expect(afterReactHeadcount).toBe(beforeHeadcount);
  expect(afterReactTotalText).toBe(beforeTotalText);
  expect(afterReactMedianText).toBe(beforeMedianText);

  // 7. Ask about pay parity check against dashboard for exact same filters (India + Engineering)
  await page.goto('/ask');
  await page
    .getByLabel(/Compensation question/i)
    .fill('What is the median annual base salary for Engineering in India?');
  await page.getByRole('button', { name: /^Interpret$/i }).click();

  await expect(page.getByText(/Confirm Interpreted Report/i)).toBeVisible();
  await page.getByRole('button', { name: /Confirm & Run Report/i }).click();

  await expect(page.getByTestId('ask-headcount')).toBeVisible();
  expect(parseHeadcount((await page.getByTestId('ask-headcount').textContent()) ?? '0')).toBe(
    afterReactHeadcount,
  );
  expect((await page.getByTestId('ask-total').textContent())?.trim()).toBe(afterReactTotalText);
  expect((await page.getByTestId('ask-median').textContent())?.trim()).toBe(afterReactMedianText);

  // 8. Read-only Raise-Cost Preview parity with dashboard and matching directory cohort link
  await page.goto('/preview?country=IN&department=ENG&raisePercent=5');
  await expect(page.getByTestId('preview-headcount')).toBeVisible();
  expect(parseHeadcount((await page.getByTestId('preview-headcount').textContent()) ?? '0')).toBe(
    afterReactHeadcount,
  );
  expect((await page.getByTestId('preview-current-spend').textContent())?.trim()).toBe(
    afterReactTotalText,
  );

  // Follow "Open matching employees" link and verify directory matches the exact active cohort count
  await page.getByRole('link', { name: /Open matching employees/i }).click();
  await expect(page.getByRole('heading', { name: /Employee Directory/i })).toBeVisible();
  await expect(page.getByText(/matching employees/i)).toContainText(
    afterReactHeadcount.toLocaleString(),
  );
});
