import { CURRENCY_DECIMALS, type CurrencyCode } from './lookups.js';

/**
 * Maximum single-employee annual salary supported in minor units:
 * 1,000,000,000.00 (1 billion major units = 100,000,000,000 minor units).
 * Comfortably fits PostgreSQL BIGINT even when summing 10,000+ employees.
 */
export const MAX_SALARY_MINOR = 100_000_000_000n;
export const MIN_SALARY_MINOR = 1n; // Strictly positive (> 0.00)

const DECIMAL_STRING_RE = /^\d+(?:\.\d{1,2})?$/;

export const MAX_RAISE_PERCENT_BPS = 10_000n; // 100.00% expressed in hundredths of a percent (basis points)

export class MoneyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyValidationError';
  }
}

/**
 * Parse a major-unit decimal string (e.g. "125000", "125000.5", "125000.50")
 * into exact integer minor units (2 decimal places).
 * Rejects signs, whitespace-padded garbage, scientific notation, >2 decimals,
 * zero/negative values, and amounts above MAX_SALARY_MINOR.
 */
export function parseSalaryToMinor(raw: string): bigint {
  const trimmed = raw.trim();
  if (!DECIMAL_STRING_RE.test(trimmed)) {
    throw new MoneyValidationError(
      'Amount must be a positive decimal string with up to 2 decimal places.',
    );
  }
  const [wholePart = '0', fracPart = ''] = trimmed.split('.');
  const paddedFrac = fracPart.padEnd(CURRENCY_DECIMALS, '0');
  const minor = BigInt(wholePart) * 100n + BigInt(paddedFrac);
  if (minor < MIN_SALARY_MINOR) {
    throw new MoneyValidationError('Salary amount must be greater than zero.');
  }
  if (minor > MAX_SALARY_MINOR) {
    throw new MoneyValidationError('Salary amount exceeds maximum allowed bound.');
  }
  return minor;
}

/**
 * Format exact integer minor units into a canonical major-unit decimal string
 * with exactly 2 fractional digits (e.g. 12500050n -> "125000.50").
 */
export function formatMinorToDecimalString(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(CURRENCY_DECIMALS, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`;
}

/**
 * Format exact minor units for UI display with thousands separators and explicit currency code.
 * Example: formatMoneyDisplay(400000000n, 'INR') -> "INR 4,000,000.00"
 */
export function formatMoneyDisplay(minor: bigint | string, currency: CurrencyCode): string {
  const decimalStr = typeof minor === 'bigint' ? formatMinorToDecimalString(minor) : minor;
  const negative = decimalStr.startsWith('-');
  const unsigned = negative ? decimalStr.slice(1) : decimalStr;
  const [whole = '0', frac = '00'] = unsigned.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${negative ? '-' : ''}${grouped}.${frac.padEnd(2, '0')}`;
}

/**
 * Exact half-up rounding of (numerator / denominator) for non-negative BigInts:
 * 2 * remainder >= denominator => round up.
 */
export function divRoundHalfUpExact(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error('Denominator must be positive');
  }
  if (numerator < 0n) {
    throw new Error('Numerator must be non-negative');
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

/**
 * Convert native minor units to USD minor units using an exact decimal string rate
 * (e.g. "0.0125"), rounding half-up to 1 USD cent.
 * Assumes equal minor-unit scale (2 decimals) across supported currencies.
 */
export function convertMinorToUsdHalfUp(nativeMinor: bigint, rateToUsdDecimal: string): bigint {
  const cleaned = rateToUsdDecimal.trim();
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) {
    throw new MoneyValidationError(`Invalid FX rate: ${rateToUsdDecimal}`);
  }
  const [whole = '0', frac = ''] = cleaned.split('.');
  const scale = 10n ** BigInt(frac.length);
  const rateScaled = BigInt(whole) * scale + BigInt(frac || '0');
  if (rateScaled <= 0n) {
    throw new MoneyValidationError('FX rate must be positive.');
  }
  return divRoundHalfUpExact(nativeMinor * rateScaled, scale);
}

/**
 * Compute exact median over sorted (or unsorted) bigint minor-unit array.
 * Odd count: middle value. Even count: mean of middle two rounded half-up.
 * Empty array: null.
 */
export function computeExactMedianMinor(values: readonly bigint[]): bigint | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  const lower = sorted[mid - 1]!;
  const upper = sorted[mid]!;
  return divRoundHalfUpExact(lower + upper, 2n);
}

/**
 * Parse a positive percentage string with up to 2 fractional digits (e.g. "5", "5.25")
 * into exact integer basis points (hundredths of a percent, so "5" -> 500n, "5.25" -> 525n).
 * Valid range: 0.01% to 100.00%.
 */
export function parseRaisePercentToBasisPoints(raw: string): bigint {
  const trimmed = raw.trim();
  if (!DECIMAL_STRING_RE.test(trimmed)) {
    throw new MoneyValidationError(
      'Raise percentage must be a positive decimal string with up to 2 decimal places.',
    );
  }
  const [wholePart = '0', fracPart = ''] = trimmed.split('.');
  const bps = BigInt(wholePart) * 100n + BigInt(fracPart.padEnd(2, '0'));
  if (bps < 1n) {
    throw new MoneyValidationError('Raise percentage must be greater than zero.');
  }
  if (bps > MAX_RAISE_PERCENT_BPS) {
    throw new MoneyValidationError('Raise percentage cannot exceed 100.00%.');
  }
  return bps;
}

/**
 * Project a single employee's native minor-unit salary for a percentage raise
 * (expressed in basis points where 500n = 5.00%), rounding half-up to 1 native minor unit.
 * Formula: round_half_up(currentMinor * (10000 + bps) / 10000)
 */
export function projectNativeSalaryMinorHalfUp(currentMinor: bigint, raiseBps: bigint): bigint {
  return divRoundHalfUpExact(currentMinor * (10_000n + raiseBps), 10_000n);
}
