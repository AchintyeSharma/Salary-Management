import { Router } from 'express';
import {
  COUNTRIES,
  COUNTRY_TO_CURRENCY,
  DEPARTMENTS,
  LEVELS,
  parseRaisePercentToBasisPoints,
  payQuestionRequestSchema,
  validatedRaisePreviewIntentSchema,
  validatedReportIntentSchema,
  type CountryCode,
  type CurrencyCode,
  type DepartmentCode,
  type LevelCode,
  type PayQuestionInterpretResponse,
  type PayQuestionMetric,
  type ReportGroupBy,
  type ValidatedRaisePreviewIntent,
  type ValidatedReportIntent,
} from '@acme/contracts';
import { createSimpleRateLimiter } from '../auth/session.js';
import type { AppConfig } from '../config.js';

export interface PayQuestionInterpreter {
  readonly mode: 'deterministic' | 'live';
  interpret(question: string): Promise<PayQuestionInterpretResponse>;
}

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const EMP_NUMBER_RE = /\bEMP[-_]?\d{3,}\b/i;

const OVERRIDE_PATTERNS = [
  /\bignore\s+(all\s+)?(previous|prior|system)\b/i,
  /\boverride\s+(the\s+)?(catalogue|catalog|rules|policy)\b/i,
  /\b(drop\s+table|select\s+\*|union\s+select|delete\s+from|update\s+employees)\b/i,
  /\brun\s+raw\s+sql\b/i,
];

const WRITE_PATTERNS = [
  /\b(give|grant|apply|approve)\b.*\b(raise|increase|bump|bonus|salary)\b/i,
  /\b(change|update|set|modify|revise|edit|adjust)\b.*\b(salary|salaries|pay|compensation|department|level)\b/i,
  /\b(deactivate|reactivate|delete|remove|terminate|add\s+employee|create\s+employee)\b/i,
];

const HISTORY_OR_OUT_OF_SCOPE_PATTERNS = [
  /\b(history|historical|trend|over\s+time|last\s+year|previous\s+year|year[- ]over[- ]year|yoy|202[0-5]|future[- ]dated|retroactive)\b/i,
  /\b(equity|rsu|stock\s+options|variable\s+pay|commission|bonus|payroll\s+tax|tax\s+withholding|pay\s+band|compa[- ]?ratio)\b/i,
];

const EMPLOYEE_SPECIFIC_PATTERNS = [
  /\b(what\s+does|how\s+much\s+does)\s+[a-z]+\s+[a-z]+\s+(make|earn|get\s+paid)\b/i,
  /\bsalary\s+(for|of)\s+(?!engineering|product|design|sales|operations|finance|hr|people|india|germany|uk|united|us|usa|active|inactive|all|l[1-7]\b)[A-Z][a-z]+\s+[A-Z][a-z]+\b/,
  /\bwho\s+(earns|makes)\s+the\s+(most|least)\b/i,
  /\btop\s+\d+\s+(paid|earners|employees)\b/i,
];

const UNSUPPORTED_COUNTRY_RE =
  /\b(south\s+africa|south\s+african|kenya|kenyan|nigeria|nigerian|ghana|ghanaian|egypt|egyptian|uae|dubai|brazil|brazilian|russia|russian|china|chinese|japan|japanese|korea|korean|singapore|australia|australian|new\s+zealand|canada|canadian|mexico|mexican|france|french|italy|italian|spain|spanish|switzerland|swiss|sweden|swedish|netherlands|dutch|ireland|irish|poland|polish|norway|norwegian|denmark|danish|finland|finnish|belgium|belgian|austria|austrian|portugal|portuguese|greece|greek|turkey|turkish|israel|israeli|saudi\s+arabia|saudi|argentina|chile|colombia|philippines|vietnam|thailand|indonesia|malaysia|pakistan|bangladesh)\b/i;

const SUPPORTED_TERMS = new Set([
  'the us', 'us', 'usa', 'u.s.', 'u.s.a.', 'united states', 'america', 'india', 'the uk', 'uk', 'u.k.', 'united kingdom',
  'britain', 'england', 'germany', 'deutschland', 'engineering', 'engineers', 'product', 'design', 'designers', 'sales',
  'operations', 'ops', 'finance', 'hr', 'people', 'human resources', 'all', 'active', 'inactive', 'country', 'countries',
  'department', 'departments', 'dept', 'depts', 'level', 'levels', 'the company', 'the org', 'the organization', 'acme',
  'total', 'median', 'headcount', 'salary', 'salaries', 'pay', 'compensation', 'dollars', 'rupees', 'pounds', 'euros',
  'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'
]);

function detectUnknownLocation(text: string): boolean {
  const matches = text.matchAll(/\b(?:in|across)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g);
  for (const m of matches) {
    const candidate = m[1]!.toLowerCase().trim();
    if (!SUPPORTED_TERMS.has(candidate)) {
      return true;
    }
  }
  return false;
}

function matchesUsCountry(question: string): boolean {
  // Replace object pronouns: 'show us', 'tell us', 'give us', 'let us', 'send us', 'allow us', 'help us'
  const sanitized = question.replace(
    /\b(show|tell|give|let|send|allow|help|provide|inform)\s+us\b/gi,
    '$1 __PRONOUN__',
  );
  const caseInsensitivePatterns =
    /\b(united\s+states|u\.s\.a\.?|usa|u\.s\.|america|american)\b|\b(?:in|for|across|of|from|within)\s+(?:the\s+)?us\b|\bthe\s+us\b/i;
  const uppercaseUs = /\bUS\b/;
  return caseInsensitivePatterns.test(sanitized) || uppercaseUs.test(sanitized);
}

const UNSUPPORTED_GROUP_RE =
  /\b(by|per|across)\s+(manager|gender|age|tenure|city|office|location|title|job\s+title|hire\s+date|currency|team|role)\b/i;

const COUNTRY_MATCHERS: { code: CountryCode; matches: (q: string) => boolean }[] = [
  { code: 'US', matches: matchesUsCountry },
  { code: 'IN', matches: (q) => /\b(india|indian)\b/i.test(q) },
  { code: 'GB', matches: (q) => /\b(united\s+kingdom|u\.k\.|uk|britain|british|england|gb)\b/i.test(q) },
  { code: 'DE', matches: (q) => /\b(germany|german|deutschland)\b/i.test(q) },
];

const DEPARTMENT_MATCHERS: { code: DepartmentCode; re: RegExp }[] = [
  { code: 'ENG', re: /\b(engineering|engineers?|eng)\b/i },
  { code: 'PROD', re: /\b(product(\s+management)?|prod)\b/i },
  { code: 'DESIGN', re: /\b(design|designers?)\b/i },
  { code: 'SALES', re: /\b(sales|account\s+executives?)\b/i },
  { code: 'OPS', re: /\b(operations|ops)\b/i },
  { code: 'FIN', re: /\b(finance|financial|fin)\b/i },
  { code: 'HR', re: /\b(people\s*&?\s*hr|human\s+resources|people\s+team|hr\s+department|\bhr\b)\b/i },
];

const COUNTRY_NAME = new Map<string, string>(COUNTRIES.map((c) => [c.code, c.name]));
const DEPT_NAME = new Map<string, string>(DEPARTMENTS.map((d) => [d.code, d.name]));
const LEVEL_NAME = new Map<string, string>(LEVELS.map((l) => [l.code, l.code]));

function buildValidatedIntent(params: {
  metric: PayQuestionMetric;
  country?: CountryCode;
  department?: DepartmentCode;
  level?: LevelCode;
  status: 'active' | 'inactive' | 'all';
  groupBy?: ReportGroupBy;
}): ValidatedReportIntent {
  const conversionExpected = Boolean(params.groupBy) || !params.country;
  const expectedCurrency: CurrencyCode = conversionExpected
    ? 'USD'
    : COUNTRY_TO_CURRENCY[params.country!];

  const reportSearch = new URLSearchParams();
  const dirSearch = new URLSearchParams();
  if (params.country) {
    reportSearch.set('country', params.country);
    dirSearch.set('country', params.country);
  }
  if (params.department) {
    reportSearch.set('department', params.department);
    dirSearch.set('department', params.department);
  }
  if (params.level) {
    reportSearch.set('level', params.level);
    dirSearch.set('level', params.level);
  }
  reportSearch.set('status', params.status);
  dirSearch.set('status', params.status);
  if (params.groupBy) {
    reportSearch.set('groupBy', params.groupBy);
  }

  const metricLabel =
    params.metric === 'headcount'
      ? 'Headcount'
      : params.metric === 'total'
        ? 'Total annual base salary'
        : params.metric === 'median'
          ? 'Median annual base salary'
          : 'Compensation overview (headcount, total, and median annual base salary)';

  const cohortParts: string[] = [
    params.status === 'active'
      ? 'active employees'
      : params.status === 'inactive'
        ? 'inactive employees'
        : 'all employees',
  ];
  if (params.department) cohortParts.push(DEPT_NAME.get(params.department) ?? params.department);
  if (params.level) cohortParts.push(LEVEL_NAME.get(params.level) ?? params.level);
  if (params.country) cohortParts.push(`in ${COUNTRY_NAME.get(params.country) ?? params.country}`);
  if (params.groupBy) cohortParts.push(`grouped by ${params.groupBy}`);

  const candidate: ValidatedReportIntent = {
    metric: params.metric,
    filters: {
      ...(params.country ? { country: params.country } : {}),
      ...(params.department ? { department: params.department } : {}),
      ...(params.level ? { level: params.level } : {}),
      status: params.status,
      ...(params.groupBy ? { groupBy: params.groupBy } : {}),
    },
    expectedCurrency,
    conversionExpected,
    label: `${metricLabel} for ${cohortParts.join(' ')}`,
    dashboardPath: `/reports?${reportSearch.toString()}`,
    directoryPath: `/employees?${dirSearch.toString()}`,
  };

  return validatedReportIntentSchema.parse(candidate);
}

function buildValidatedPreviewIntent(params: {
  country?: CountryCode;
  department?: DepartmentCode;
  level?: LevelCode;
  raisePercent: string;
}): ValidatedRaisePreviewIntent {
  // Validate percentage exact bounds/precision
  parseRaisePercentToBasisPoints(params.raisePercent);

  const conversionExpected = !params.country;
  const expectedCurrency: CurrencyCode = conversionExpected
    ? 'USD'
    : COUNTRY_TO_CURRENCY[params.country!];

  const previewSearch = new URLSearchParams();
  const dirSearch = new URLSearchParams();
  if (params.country) {
    previewSearch.set('country', params.country);
    dirSearch.set('country', params.country);
  }
  if (params.department) {
    previewSearch.set('department', params.department);
    dirSearch.set('department', params.department);
  }
  if (params.level) {
    previewSearch.set('level', params.level);
    dirSearch.set('level', params.level);
  }
  previewSearch.set('raisePercent', params.raisePercent);
  dirSearch.set('status', 'active');

  const cohortParts: string[] = ['active employees'];
  if (params.department) cohortParts.push(DEPT_NAME.get(params.department) ?? params.department);
  if (params.level) cohortParts.push(LEVEL_NAME.get(params.level) ?? params.level);
  if (params.country) cohortParts.push(`in ${COUNTRY_NAME.get(params.country) ?? params.country}`);

  return validatedRaisePreviewIntentSchema.parse({
    filters: {
      ...(params.country ? { country: params.country } : {}),
      ...(params.department ? { department: params.department } : {}),
      ...(params.level ? { level: params.level } : {}),
      status: 'active',
    },
    raisePercent: params.raisePercent,
    expectedCurrency,
    conversionExpected,
    label: `Preview ${params.raisePercent}% raise cost for ${cohortParts.join(' ')}`,
    previewPath: `/preview?${previewSearch.toString()}`,
    directoryPath: `/employees?${dirSearch.toString()}`,
  });
}

const RAISE_PREVIEW_CUE_RE =
  /\b(preview|estimate|estimated\s+cost|what\s+would|how\s+much\s+would|simulate|cost\s+of)\b.*\b(raise|increase)\b|\b(raise|increase)\b.*\b(cost|preview|estimate)\b/i;

const PERCENT_EXTRACT_RE = /(\d+(?:\.\d{1,3})?)\s*(?:%|percent\b)/i;

export class DeterministicPayQuestionInterpreter implements PayQuestionInterpreter {
  readonly mode = 'deterministic' as const;

  async interpret(rawQuestion: string): Promise<PayQuestionInterpretResponse> {
    const question = rawQuestion.trim();

    // 1. Reject obvious personal identifiers
    if (EMAIL_RE.test(question) || EMP_NUMBER_RE.test(question)) {
      return {
        mode: this.mode,
        outcome: 'unsupported',
        reasonCode: 'CONTAINS_IDENTIFIER',
        summary: 'Questions containing email addresses or employee numbers are not accepted here.',
        guidance:
          'Use the Employee Directory to look up an individual employee by employee number or name.',
      };
    }

    // 2. Reject catalogue override / injection attempts
    if (OVERRIDE_PATTERNS.some((re) => re.test(question))) {
      return {
        mode: this.mode,
        outcome: 'unsupported',
        reasonCode: 'UNSUPPORTED_OVERRIDE',
        summary: 'Ask about pay only executes approved compensation reports from the fixed catalogue.',
        guidance: 'Use the supported aggregate metrics (headcount, total, median) or open Reports directly.',
      };
    }

    // 3. Reject write / salary-mutation requests
    if (WRITE_PATTERNS.some((re) => re.test(question))) {
      return {
        mode: this.mode,
        outcome: 'unsupported',
        reasonCode: 'WRITE_REQUEST',
        summary: 'Ask about pay is read-only and cannot change employee salaries or profiles.',
        guidance:
          'Open an employee record in the Employee Directory to make auditable profile or salary changes.',
      };
    }

    // 4. Reject history/trends/out-of-scope compensation domains
    if (HISTORY_OR_OUT_OF_SCOPE_PATTERNS.some((re) => re.test(question))) {
      return {
        mode: this.mode,
        outcome: 'unsupported',
        reasonCode: 'HISTORY_TREND',
        summary:
          'Only current annual gross base salary reports are supported (history trends, taxes, bonuses, equity, and pay bands are out of scope).',
        guidance:
          'View individual revision timelines on an employee profile, or explore current base pay in Reports.',
      };
    }

    // 5. Reject employee-specific / ranking questions
    if (EMPLOYEE_SPECIFIC_PATTERNS.some((re) => re.test(question))) {
      return {
        mode: this.mode,
        outcome: 'unsupported',
        reasonCode: 'EMPLOYEE_SPECIFIC',
        summary: 'Employee-specific lookups and individual salary rankings are not part of aggregate reporting.',
        guidance: 'Search or sort employees directly in the Employee Directory.',
      };
    }

    // 6. Reject unknown countries or unsupported group-by dimensions explicitly
    if (
      UNSUPPORTED_COUNTRY_RE.test(question) ||
      UNSUPPORTED_GROUP_RE.test(question) ||
      detectUnknownLocation(question)
    ) {
      return {
        mode: this.mode,
        outcome: 'unsupported',
        reasonCode: 'UNSUPPORTED_DIMENSION',
        summary:
          'Your question references a country or grouping outside ACME’s supported reporting dimensions.',
        guidance:
          'Supported countries are US, India, UK, and Germany. Supported groupings are country, department, and level.',
      };
    }

    // Extract controlled filter dimensions
    const matchedCountries = COUNTRY_MATCHERS.filter((m) => m.matches(question)).map((m) => m.code);
    const matchedDepts = DEPARTMENT_MATCHERS.filter((m) => m.re.test(question)).map((m) => m.code);
    const levelMatches = [...question.matchAll(/\b(L[1-7])\b/gi)].map(
      (m) => m[1]!.toUpperCase() as LevelCode,
    );
    const uniqueLevels = [...new Set(levelMatches)];

    if (matchedCountries.length > 1 || matchedDepts.length > 1 || uniqueLevels.length > 1) {
      return {
        mode: this.mode,
        outcome: 'clarification_needed',
        summary: 'Multiple values were detected for a single filter dimension.',
        clarificationPrompt:
          'To compare across countries, departments, or levels, choose a grouped breakdown below.',
        options: [
          buildValidatedIntent({
            metric: 'median',
            status: 'active',
            groupBy:
              matchedCountries.length > 1
                ? 'country'
                : matchedDepts.length > 1
                  ? 'department'
                  : 'level',
            ...(matchedDepts.length === 1 ? { department: matchedDepts[0] } : {}),
            ...(matchedCountries.length === 1 ? { country: matchedCountries[0] } : {}),
            ...(uniqueLevels.length === 1 ? { level: uniqueLevels[0] } : {}),
          }),
          buildValidatedIntent({
            metric: 'total',
            status: 'active',
            groupBy:
              matchedCountries.length > 1
                ? 'country'
                : matchedDepts.length > 1
                  ? 'department'
                  : 'level',
            ...(matchedDepts.length === 1 ? { department: matchedDepts[0] } : {}),
            ...(matchedCountries.length === 1 ? { country: matchedCountries[0] } : {}),
            ...(uniqueLevels.length === 1 ? { level: uniqueLevels[0] } : {}),
          }),
        ],
      };
    }

    const country = matchedCountries[0];
    const department = matchedDepts[0];
    const level = uniqueLevels[0];

    // Read-only raise-cost preview intent (distinct from imperative write commands caught above)
    if (RAISE_PREVIEW_CUE_RE.test(question)) {
      // Check for negative percentage (both ASCII '-' and Unicode minus '−' \u2212)
      if (/[-−\u2212]\s*\d+(?:\.\d+)?\s*(?:%|percent\b)/i.test(question)) {
        return {
          mode: this.mode,
          outcome: 'unsupported',
          reasonCode: 'UNRECOGNIZED',
          summary: 'Negative raise percentages are not supported.',
          guidance: 'Enter a positive percentage between 0.01% and 100.00% to preview raise costs.',
        };
      }

      const asksInactive = /\binactive\b/i.test(question);
      const pctMatch = question.match(PERCENT_EXTRACT_RE);
      if (!pctMatch?.[1]) {
        return {
          mode: this.mode,
          outcome: 'unsupported',
          reasonCode: 'UNRECOGNIZED',
          summary: 'Please specify a positive percentage (up to 2 decimal places) to preview a raise cost.',
          guidance: 'Example: "What would a 5% raise cost for Engineering in India?" or use the Raise Preview page.',
        };
      }

      if (asksInactive) {
        const previewIntent = buildValidatedPreviewIntent({
          country,
          department,
          level,
          raisePercent: pctMatch[1],
        });
        return {
          mode: this.mode,
          outcome: 'clarification_needed',
          summary:
            'Raise cost previews only support active employees (inactive employees have no ongoing payroll cost).',
          clarificationPrompt:
            'Raise cost previews only support active employees. Explicit agreement is required before proceeding to preview this raise for active employees only.',
          previewIntent,
        };
      }
      try {
        const previewIntent = buildValidatedPreviewIntent({
          country,
          department,
          level,
          raisePercent: pctMatch[1],
        });
        return {
          mode: this.mode,
          outcome: 'preview_intent',
          summary: `Ready to preview (read-only): ${previewIntent.label}.`,
          previewIntent,
        };
      } catch (err) {
        return {
          mode: this.mode,
          outcome: 'unsupported',
          reasonCode: 'UNRECOGNIZED',
          summary: err instanceof Error ? err.message : 'Invalid raise percentage.',
          guidance: 'Enter a positive percentage between 0.01% and 100.00% (up to 2 decimals).',
        };
      }
    }

    let status: 'active' | 'inactive' | 'all' = 'active';
    if (/\bincluding\s+inactive\b|\ball\s+employees\b/i.test(question)) {
      status = 'all';
    } else if (/\binactive\b/i.test(question)) {
      status = 'inactive';
    }

    // Extract grouping
    let groupBy: ReportGroupBy | undefined;
    if (/\b(by|per|across|compare)\s+(country|countries)\b/i.test(question)) {
      groupBy = 'country';
    } else if (/\b(by|per|across|compare)\s+(department|departments|dept|depts)\b/i.test(question)) {
      groupBy = 'department';
    } else if (/\b(by|per|across|compare)\s+(level|levels)\b/i.test(question)) {
      groupBy = 'level';
    }

    // Detect metric keywords
    const asksMedian = /\b(median|midpoint)\b/i.test(question);
    const asksTotal = /\b(total|spend|sum|payroll|cost)\b/i.test(question);
    const asksHeadcount = /\b(how\s+many|headcount|count|number\s+of\s+employees)\b/i.test(question);
    const asksOverview = /\b(overview|summary|breakdown|break\s+down|report)\b/i.test(question);

    // Ambiguous superlative questions ("Which department pays the most?" / "highest pay by country")
    const isAmbiguousHighest =
      /\b(which|what)\s+(country|countries|department|departments|level|levels)\s+(pays|has\s+the\s+highest|has\s+the\s+most|is\s+highest)/i.test(
        question,
      ) &&
      !asksMedian &&
      !asksTotal &&
      !asksHeadcount;

    if (isAmbiguousHighest) {
      const inferredGroup: ReportGroupBy = /\bcountr/i.test(question)
        ? 'country'
        : /\blevel/i.test(question)
          ? 'level'
          : 'department';

      return {
        mode: this.mode,
        outcome: 'clarification_needed',
        summary: `“Pays the most” can mean either highest total annual base salary spend or highest median annual base salary by ${inferredGroup}.`,
        clarificationPrompt: `Choose whether to compare by total annual base salary or median annual base salary grouped by ${inferredGroup}:`,
        options: [
          buildValidatedIntent({
            metric: 'total',
            country,
            department,
            level,
            status,
            groupBy: inferredGroup,
          }),
          buildValidatedIntent({
            metric: 'median',
            country,
            department,
            level,
            status,
            groupBy: inferredGroup,
          }),
        ],
      };
    }

    // Resolve metric
    let metric: PayQuestionMetric | null = null;
    if (asksMedian && !asksTotal && !asksHeadcount) {
      metric = 'median';
    } else if (asksTotal && !asksMedian && !asksHeadcount) {
      metric = 'total';
    } else if (asksHeadcount && !asksMedian && !asksTotal) {
      metric = 'headcount';
    } else if (asksOverview || (asksMedian && asksTotal)) {
      metric = 'overview';
    } else if (/\b(salary|salaries|pay|compensation)\b/i.test(question) && (country || department || level || groupBy)) {
      metric = 'overview';
    }

    if (!metric) {
      return {
        mode: this.mode,
        outcome: 'unsupported',
        reasonCode: 'UNRECOGNIZED',
        summary:
          'Could not map this question to a supported compensation report (headcount, total annual base salary, or median).',
        guidance:
          'Try one of the example prompts or apply filters directly on the Compensation Reports dashboard.',
      };
    }

    const intent = buildValidatedIntent({
      metric,
      country,
      department,
      level,
      status,
      groupBy,
    });

    return {
      mode: this.mode,
      outcome: 'report_intent',
      summary: `Ready to run: ${intent.label}.`,
      intent,
    };
  }
}

export function createPayQuestionsRouter(
  config: AppConfig,
  customInterpreter?: PayQuestionInterpreter,
): Router {
  const router = Router();
  const interpreter: PayQuestionInterpreter =
    customInterpreter ?? new DeterministicPayQuestionInterpreter();
  const questionLimiter = createSimpleRateLimiter(60, 60_000);

  router.post('/interpret', questionLimiter, async (req, res, next) => {
    try {
      const { question } = payQuestionRequestSchema.parse(req.body);

      if (config.payInterpreterMode === 'live' && !customInterpreter) {
        // Live provider mode requires an explicit configured adapter; fall back gracefully.
        const fallback = await interpreter.interpret(question);
        res.status(200).json({
          ...fallback,
          mode: 'deterministic',
          summary: `${fallback.summary} (Live provider is not configured; evaluated in deterministic mode.)`,
        });
        return;
      }

      const result = await interpreter.interpret(question);

      // Server-side allowlist validation on every returned intent regardless of interpreter mode.
      if (result.outcome === 'report_intent' && result.intent) {
        result.intent = validatedReportIntentSchema.parse(result.intent);
      }
      if (result.outcome === 'preview_intent' && result.previewIntent) {
        result.previewIntent = validatedRaisePreviewIntentSchema.parse(result.previewIntent);
      }
      if (result.outcome === 'clarification_needed' && result.options) {
        result.options = result.options.map((opt) => validatedReportIntentSchema.parse(opt));
      }

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
