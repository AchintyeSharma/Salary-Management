import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import {
  formatMoneyDisplay,
  type CompensationReportResponse,
  type PayQuestionInterpretResponse,
  type RaiseCostPreviewResponse,
  type ValidatedRaisePreviewIntent,
  type ValidatedReportIntent,
} from '@acme/contracts';
import {
  ApiClientError,
  fetchCompensationReport,
  interpretPayQuestion,
  previewRaiseCost,
} from '../../api/client';

const EXAMPLE_QUESTIONS = [
  'What is the median annual base salary for Engineering in India?',
  'How does annual base salary spend break down by country?',
  'What would a 5% raise cost for Engineering in India?',
  'How many active L4 engineers are in the US?',
  'Which department pays the most?',
];

export function renderAnswerHeadline(
  intent: ValidatedReportIntent,
  report: CompensationReportResponse,
): string {
  const { headcount, totalAnnualBaseSalary, medianAnnualBaseSalary } = report.summary;
  if (headcount === 0) {
    return `No matching employees found (${report.filters.status} cohort).`;
  }
  if (intent.metric === 'headcount') {
    return `${headcount.toLocaleString()} matching employees (${report.filters.status}).`;
  }
  if (intent.metric === 'median') {
    return `Median annual base salary: ${formatMoneyDisplay(medianAnnualBaseSalary!, report.currency)} across ${headcount.toLocaleString()} employees.`;
  }
  if (intent.metric === 'total') {
    return `Total annual base salary: ${formatMoneyDisplay(totalAnnualBaseSalary, report.currency)} across ${headcount.toLocaleString()} employees.`;
  }
  return `Headcount: ${headcount.toLocaleString()} · Total: ${formatMoneyDisplay(totalAnnualBaseSalary, report.currency)} · Median: ${formatMoneyDisplay(medianAnnualBaseSalary!, report.currency)}.`;
}

export function AskAboutPayPage() {
  const [question, setQuestion] = useState('');
  const [interpretation, setInterpretation] = useState<PayQuestionInterpretResponse | null>(null);
  const [pendingIntent, setPendingIntent] = useState<ValidatedReportIntent | null>(null);
  const [pendingPreviewIntent, setPendingPreviewIntent] =
    useState<ValidatedRaisePreviewIntent | null>(null);
  const [confirmedReport, setConfirmedReport] = useState<{
    intent: ValidatedReportIntent;
    report: CompensationReportResponse;
  } | null>(null);
  const [confirmedPreview, setConfirmedPreview] = useState<{
    intent: ValidatedRaisePreviewIntent;
    preview: RaiseCostPreviewResponse;
  } | null>(null);

  const interpretMutation = useMutation({
    mutationFn: interpretPayQuestion,
    onSuccess: (res) => {
      setInterpretation(res);
      setConfirmedReport(null);
      setConfirmedPreview(null);
      setPendingIntent(res.outcome === 'report_intent' && res.intent ? res.intent : null);
      setPendingPreviewIntent(
        res.outcome === 'preview_intent' && res.previewIntent ? res.previewIntent : null,
      );
    },
  });

  const executeMutation = useMutation({
    mutationFn: (intent: ValidatedReportIntent) => fetchCompensationReport(intent.filters),
    onSuccess: (report, intent) => {
      setConfirmedPreview(null);
      setConfirmedReport({ intent, report });
    },
  });

  const executePreviewMutation = useMutation({
    mutationFn: (intent: ValidatedRaisePreviewIntent) =>
      previewRaiseCost({
        country: intent.filters.country,
        department: intent.filters.department,
        level: intent.filters.level,
        raisePercent: intent.raisePercent,
      }),
    onSuccess: (preview, intent) => {
      setConfirmedReport(null);
      setConfirmedPreview({ intent, preview });
    },
  });

  function submitQuestion(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setQuestion(trimmed);
    setConfirmedReport(null);
    setConfirmedPreview(null);
    interpretMutation.mutate(trimmed);
  }

  function handleFormSubmit(event: FormEvent) {
    event.preventDefault();
    submitQuestion(question);
  }

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'center' }}
        spacing={1}
      >
        <Box>
          <Typography variant="h4" component="h1">
            Ask About Pay
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Ask a current aggregate compensation question, confirm the interpreted report, and run
            it against the same reporting engine as the dashboard.
          </Typography>
        </Box>
        <Chip
          label={`Mode: ${interpretation?.mode === 'live' ? 'Live LLM' : 'Deterministic (No External API)'}`}
          color="secondary"
          variant="outlined"
        />
      </Stack>

      <Paper sx={{ p: 3 }}>
        <Box component="form" onSubmit={handleFormSubmit} noValidate>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Compensation question"
              placeholder="e.g. What is the median annual base salary for Engineering in India?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              fullWidth
              inputProps={{ maxLength: 300 }}
            />
            <Button
              type="submit"
              variant="contained"
              sx={{ minWidth: 150 }}
              disabled={interpretMutation.isPending || question.trim().length < 3}
            >
              {interpretMutation.isPending ? 'Interpreting...' : 'Interpret'}
            </Button>
          </Stack>
        </Box>

        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Supported examples:
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {EXAMPLE_QUESTIONS.map((example) => (
              <Chip
                key={example}
                label={example}
                size="small"
                clickable
                onClick={() => submitQuestion(example)}
              />
            ))}
          </Stack>
        </Box>
      </Paper>

      {(interpretMutation.isPending ||
        executeMutation.isPending ||
        executePreviewMutation.isPending) && <LinearProgress />}

      {interpretMutation.isError && (
        <Alert severity="error">
          {interpretMutation.error instanceof ApiClientError
            ? interpretMutation.error.message
            : 'Unable to interpret question right now. You can use Compensation Reports directly.'}
        </Alert>
      )}

      {interpretation?.outcome === 'unsupported' && (
        <Alert severity="warning">
          <Typography variant="subtitle2">{interpretation.summary}</Typography>
          {interpretation.guidance && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {interpretation.guidance}
            </Typography>
          )}
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            <Button size="small" variant="outlined" component={RouterLink} to="/reports">
              Open Compensation Reports
            </Button>
            <Button size="small" variant="outlined" component={RouterLink} to="/employees">
              Open Employee Directory
            </Button>
          </Stack>
        </Alert>
      )}

      {interpretation?.outcome === 'clarification_needed' &&
        !pendingIntent &&
        !pendingPreviewIntent && (
          <Paper sx={{ p: 3, borderLeft: '4px solid', borderColor: 'warning.main' }}>
            <Typography variant="h6" gutterBottom>
              Clarification needed
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {interpretation.summary}
            </Typography>
            <Typography variant="body2" sx={{ mb: 2 }}>
              {interpretation.clarificationPrompt}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} flexWrap="wrap" useFlexGap>
              {interpretation.options?.map((option, idx) => (
                <Button
                  key={idx}
                  variant="outlined"
                  onClick={() => {
                    setPendingIntent(option);
                    setConfirmedReport(null);
                  }}
                >
                  {option.label}
                </Button>
              ))}
              {interpretation.previewIntent && (
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={() => {
                    setPendingPreviewIntent(interpretation.previewIntent!);
                    setConfirmedPreview(null);
                  }}
                >
                  Agree &amp; Preview for Active Employees
                </Button>
              )}
            </Stack>
          </Paper>
        )}

      {pendingIntent && (
        <Paper sx={{ p: 3, borderLeft: '4px solid', borderColor: 'primary.main' }}>
          <Typography variant="h6" gutterBottom>
            Confirm Interpreted Report
          </Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {pendingIntent.label}
          </Typography>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
            <Chip size="small" label={`Metric: ${pendingIntent.metric}`} />
            <Chip size="small" label={`Status: ${pendingIntent.filters.status}`} />
            {pendingIntent.filters.country && (
              <Chip size="small" label={`Country: ${pendingIntent.filters.country}`} />
            )}
            {pendingIntent.filters.department && (
              <Chip size="small" label={`Department: ${pendingIntent.filters.department}`} />
            )}
            {pendingIntent.filters.level && (
              <Chip size="small" label={`Level: ${pendingIntent.filters.level}`} />
            )}
            {pendingIntent.filters.groupBy && (
              <Chip size="small" label={`Group by: ${pendingIntent.filters.groupBy}`} />
            )}
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              label={
                pendingIntent.conversionExpected
                  ? `Currency basis: ${pendingIntent.expectedCurrency} (Synthetic FX)`
                  : `Currency basis: ${pendingIntent.expectedCurrency} (Native)`
              }
            />
          </Stack>

          <Stack direction="row" spacing={1.5}>
            <Button
              variant="contained"
              disabled={executeMutation.isPending}
              onClick={() => executeMutation.mutate(pendingIntent)}
            >
              Confirm &amp; Run Report
            </Button>
            <Button variant="outlined" component={RouterLink} to={pendingIntent.dashboardPath}>
              Open in Dashboard
            </Button>
          </Stack>
        </Paper>
      )}

      {pendingPreviewIntent && (
        <Paper sx={{ p: 3, borderLeft: '4px solid', borderColor: 'secondary.main' }}>
          <Typography variant="h6" gutterBottom>
            Confirm Read-Only Raise-Cost Preview
          </Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {pendingPreviewIntent.label}
          </Typography>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
            <Chip size="small" color="secondary" label={`Raise: +${pendingPreviewIntent.raisePercent}%`} />
            <Chip size="small" label="Population: active only" />
            {pendingPreviewIntent.filters.country && (
              <Chip size="small" label={`Country: ${pendingPreviewIntent.filters.country}`} />
            )}
            {pendingPreviewIntent.filters.department && (
              <Chip size="small" label={`Department: ${pendingPreviewIntent.filters.department}`} />
            )}
            {pendingPreviewIntent.filters.level && (
              <Chip size="small" label={`Level: ${pendingPreviewIntent.filters.level}`} />
            )}
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              label={
                pendingPreviewIntent.conversionExpected
                  ? `Currency basis: ${pendingPreviewIntent.expectedCurrency} (Synthetic FX)`
                  : `Currency basis: ${pendingPreviewIntent.expectedCurrency} (Native)`
              }
            />
          </Stack>

          <Stack direction="row" spacing={1.5}>
            <Button
              variant="contained"
              color="secondary"
              disabled={executePreviewMutation.isPending}
              onClick={() => executePreviewMutation.mutate(pendingPreviewIntent)}
            >
              Confirm &amp; Preview Raise Cost
            </Button>
            <Button variant="outlined" component={RouterLink} to={pendingPreviewIntent.previewPath}>
              Open in Raise Preview
            </Button>
          </Stack>
        </Paper>
      )}

      {(executeMutation.isError || executePreviewMutation.isError) && (
        <Alert severity="error">
          {executeMutation.error instanceof ApiClientError
            ? executeMutation.error.message
            : executePreviewMutation.error instanceof ApiClientError
              ? executePreviewMutation.error.message
              : 'Unable to run calculation.'}
        </Alert>
      )}

      {confirmedPreview && (
        <Card elevation={2}>
          <CardContent>
            <Typography variant="overline" color="text.secondary">
              Verified Read-Only Raise-Cost Preview (+{confirmedPreview.preview.raisePercent}%)
            </Typography>
            <Typography variant="h5" data-testid="ask-preview-headline" sx={{ mb: 1 }}>
              Estimated annual increase:{' '}
              +{formatMoneyDisplay(
                confirmedPreview.preview.differenceAnnualSpend,
                confirmedPreview.preview.currency,
              )}{' '}
              across {confirmedPreview.preview.headcount.toLocaleString()} active employees.
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {confirmedPreview.preview.definitions.currencyBasis}{' '}
              {confirmedPreview.preview.definitions.readOnly}
            </Typography>

            <Divider sx={{ my: 2 }} />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ mb: 2 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Active Headcount
                </Typography>
                <Typography variant="h6">
                  {confirmedPreview.preview.headcount.toLocaleString()}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Current Annual Spend
                </Typography>
                <Typography variant="h6" sx={{ fontFamily: 'monospace' }}>
                  {formatMoneyDisplay(
                    confirmedPreview.preview.currentAnnualSpend,
                    confirmedPreview.preview.currency,
                  )}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Projected Annual Spend
                </Typography>
                <Typography variant="h6" sx={{ fontFamily: 'monospace' }}>
                  {formatMoneyDisplay(
                    confirmedPreview.preview.projectedAnnualSpend,
                    confirmedPreview.preview.currency,
                  )}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Difference
                </Typography>
                <Typography variant="h6" color="secondary.main" sx={{ fontFamily: 'monospace' }}>
                  +
                  {formatMoneyDisplay(
                    confirmedPreview.preview.differenceAnnualSpend,
                    confirmedPreview.preview.currency,
                  )}
                </Typography>
              </Box>
            </Stack>

            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              <Button
                variant="contained"
                size="small"
                component={RouterLink}
                to={confirmedPreview.intent.previewPath}
              >
                Open in Raise Preview
              </Button>
              <Button
                variant="outlined"
                size="small"
                component={RouterLink}
                to={confirmedPreview.preview.directoryPath}
              >
                Open matching Employees
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {confirmedReport && (
        <Card elevation={2}>
          <CardContent>
            <Typography variant="overline" color="text.secondary">
              Verified Compensation Report Result
            </Typography>
            <Typography variant="h5" data-testid="ask-answer-headline" sx={{ mb: 1 }}>
              {renderAnswerHeadline(confirmedReport.intent, confirmedReport.report)}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {confirmedReport.report.definitions.currencyBasis}
            </Typography>

            <Divider sx={{ my: 2 }} />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ mb: 2 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Cohort Headcount
                </Typography>
                <Typography variant="h6" data-testid="ask-headcount">
                  {confirmedReport.report.summary.headcount.toLocaleString()}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Total Annual Base Salary
                </Typography>
                <Typography variant="h6" data-testid="ask-total" sx={{ fontFamily: 'monospace' }}>
                  {formatMoneyDisplay(
                    confirmedReport.report.summary.totalAnnualBaseSalary,
                    confirmedReport.report.currency,
                  )}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Median Annual Base Salary
                </Typography>
                <Typography variant="h6" data-testid="ask-median" sx={{ fontFamily: 'monospace' }}>
                  {confirmedReport.report.summary.medianAnnualBaseSalary !== null
                    ? formatMoneyDisplay(
                        confirmedReport.report.summary.medianAnnualBaseSalary,
                        confirmedReport.report.currency,
                      )
                    : '—'}
                </Typography>
              </Box>
            </Stack>

            {confirmedReport.report.groups.length > 0 && (
              <TableContainer sx={{ mb: 2 }}>
                <Table size="small" aria-label="Pay question grouped results">
                  <TableHead>
                    <TableRow>
                      <TableCell>Group</TableCell>
                      <TableCell align="right">Headcount</TableCell>
                      <TableCell align="right">Total Annual Base Salary</TableCell>
                      <TableCell align="right">Median Annual Base Salary</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {confirmedReport.report.groups.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell>{row.label}</TableCell>
                        <TableCell align="right">{row.headcount.toLocaleString()}</TableCell>
                        <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                          {formatMoneyDisplay(
                            row.totalAnnualBaseSalary,
                            confirmedReport.report.currency,
                          )}
                        </TableCell>
                        <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                          {row.medianAnnualBaseSalary !== null
                            ? formatMoneyDisplay(
                                row.medianAnnualBaseSalary,
                                confirmedReport.report.currency,
                              )
                            : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              <Button
                variant="contained"
                size="small"
                component={RouterLink}
                to={confirmedReport.intent.dashboardPath}
              >
                Open equivalent Dashboard view
              </Button>
              <Button
                variant="outlined"
                size="small"
                component={RouterLink}
                to={confirmedReport.intent.directoryPath}
              >
                Open matching Employees
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}
