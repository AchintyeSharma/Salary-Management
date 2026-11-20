import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DeterministicPayQuestionInterpreter } from '../../src/pay-questions/interpreter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, '../fixtures/pay-questions-eval.json');
const evalSuite = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
  version: string;
  cases: Array<{
    id: string;
    question: string;
    expectedOutcome: 'report_intent' | 'preview_intent' | 'clarification_needed' | 'unsupported';
    expectedReasonCode?: string;
    expectedIntent?: {
      metric: string;
      country?: string;
      department?: string;
      level?: string;
      status: string;
      groupBy?: string;
      expectedCurrency: string;
      conversionExpected: boolean;
    };
    expectedPreviewIntent?: {
      country?: string;
      department?: string;
      level?: string;
      raisePercent: string;
      expectedCurrency: string;
      conversionExpected: boolean;
    };
  }>;
};

describe(`Deterministic Pay Question Evaluation Suite v${evalSuite.version}`, () => {
  const interpreter = new DeterministicPayQuestionInterpreter();

  for (const tc of evalSuite.cases) {
    it(`[${tc.id}] "${tc.question}"`, async () => {
      const res = await interpreter.interpret(tc.question);
      expect(res.mode).toBe('deterministic');
      expect(res.outcome).toBe(tc.expectedOutcome);

      if (tc.expectedReasonCode) {
        expect(res.reasonCode).toBe(tc.expectedReasonCode);
      }

      if (tc.expectedIntent) {
        expect(res.intent).toBeDefined();
        expect(res.intent!.metric).toBe(tc.expectedIntent.metric);
        expect(res.intent!.filters.country).toBe(tc.expectedIntent.country);
        expect(res.intent!.filters.department).toBe(tc.expectedIntent.department);
        expect(res.intent!.filters.level).toBe(tc.expectedIntent.level);
        expect(res.intent!.filters.status).toBe(tc.expectedIntent.status);
        expect(res.intent!.filters.groupBy).toBe(tc.expectedIntent.groupBy);
        expect(res.intent!.expectedCurrency).toBe(tc.expectedIntent.expectedCurrency);
        expect(res.intent!.conversionExpected).toBe(tc.expectedIntent.conversionExpected);
      }

      if (tc.expectedPreviewIntent) {
        expect(res.previewIntent).toBeDefined();
        expect(res.previewIntent!.filters.country).toBe(tc.expectedPreviewIntent.country);
        expect(res.previewIntent!.filters.department).toBe(tc.expectedPreviewIntent.department);
        expect(res.previewIntent!.filters.level).toBe(tc.expectedPreviewIntent.level);
        expect(res.previewIntent!.filters.status).toBe('active');
        expect(res.previewIntent!.raisePercent).toBe(tc.expectedPreviewIntent.raisePercent);
        expect(res.previewIntent!.expectedCurrency).toBe(tc.expectedPreviewIntent.expectedCurrency);
        expect(res.previewIntent!.conversionExpected).toBe(
          tc.expectedPreviewIntent.conversionExpected,
        );
      }
    });
  }
});
