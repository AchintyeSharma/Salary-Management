import { describe, expect, it } from 'vitest';
import {
  computeExactMedianMinor,
  convertMinorToUsdHalfUp,
  formatMinorToDecimalString,
  formatMoneyDisplay,
  MAX_SALARY_MINOR,
  MoneyValidationError,
  parseSalaryToMinor,
} from './money.js';

describe('money parsing and formatting', () => {
  it('parses valid major-unit decimal strings to exact minor units', () => {
    expect(parseSalaryToMinor('60000')).toBe(6_000_000n);
    expect(parseSalaryToMinor('100.5')).toBe(10_050n);
    expect(parseSalaryToMinor('100.01')).toBe(10_001n);
    expect(parseSalaryToMinor('4000000.00')).toBe(400_000_000n);
  });

  it('rejects invalid precision, zero, negative, non-numeric, and out-of-bounds strings', () => {
    expect(() => parseSalaryToMinor('0')).toThrow(MoneyValidationError);
    expect(() => parseSalaryToMinor('0.00')).toThrow(MoneyValidationError);
    expect(() => parseSalaryToMinor('-100')).toThrow(MoneyValidationError);
    expect(() => parseSalaryToMinor('100.123')).toThrow(MoneyValidationError);
    expect(() => parseSalaryToMinor('1e5')).toThrow(MoneyValidationError);
    expect(() => parseSalaryToMinor('100,000')).toThrow(MoneyValidationError);
    expect(() => parseSalaryToMinor('1000000000.01')).toThrow(MoneyValidationError);
    expect(parseSalaryToMinor('1000000000.00')).toBe(MAX_SALARY_MINOR);
  });

  it('formats minor units to canonical decimal strings and currency display', () => {
    expect(formatMinorToDecimalString(10_001n)).toBe('100.01');
    expect(formatMinorToDecimalString(6_000_000n)).toBe('60000.00');
    expect(formatMoneyDisplay(400_000_000n, 'INR')).toBe('INR 4,000,000.00');
  });
});

describe('FX conversion and exact median fixtures from docs/design.md', () => {
  it('reproduces the multi-country fixture (USD 60k, USD 80k, INR 4M @ 0.0125)', () => {
    const us1 = parseSalaryToMinor('60000');
    const us2 = parseSalaryToMinor('80000');
    const in1Native = parseSalaryToMinor('4000000');
    const in1Usd = convertMinorToUsdHalfUp(in1Native, '0.0125');

    expect(in1Usd).toBe(5_000_000n); // USD 50,000.00
    const totalUsd = us1 + us2 + in1Usd;
    expect(formatMinorToDecimalString(totalUsd)).toBe('190000.00');
    expect(formatMinorToDecimalString(computeExactMedianMinor([us1, us2, in1Usd])!)).toBe(
      '60000.00',
    );
    expect(formatMinorToDecimalString(computeExactMedianMinor([in1Native])!)).toBe('4000000.00');
  });

  it('rounds even-cohort median half-up (USD 100.00 & USD 100.01 -> USD 100.01)', () => {
    const median = computeExactMedianMinor([
      parseSalaryToMinor('100.00'),
      parseSalaryToMinor('100.01'),
    ]);
    expect(formatMinorToDecimalString(median!)).toBe('100.01');
  });

  it('returns null median for an empty cohort', () => {
    expect(computeExactMedianMinor([])).toBeNull();
  });

  it('handles half-up FX rounding on small fractional cents (INR 4.25 @ 0.0125 -> USD 0.05)', () => {
    expect(convertMinorToUsdHalfUp(425n, '0.0125')).toBe(5n); // 5.3125 -> 5
    expect(convertMinorToUsdHalfUp(446n, '0.0125')).toBe(6n); // 5.575 -> 6
  });
});
