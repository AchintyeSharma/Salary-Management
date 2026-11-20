import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  formatMoneyDisplay,
  parseRaisePercentToBasisPoints,
  type CountryCode,
  type DepartmentCode,
  type LevelCode,
  type RaiseCostPreviewResponse,
} from '@acme/contracts';
import { ApiClientError, fetchLookups, previewRaiseCost } from '../../api/client';

export function RaiseCostPreviewPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [country, setCountry] = useState<CountryCode | ''>(
    (searchParams.get('country') as CountryCode) || '',
  );
  const [department, setDepartment] = useState<DepartmentCode | ''>(
    (searchParams.get('department') as DepartmentCode) || '',
  );
  const [level, setLevel] = useState<LevelCode | ''>(
    (searchParams.get('level') as LevelCode) || '',
  );
  const [raisePercent, setRaisePercent] = useState<string>(
    searchParams.get('raisePercent') || '5',
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [result, setResult] = useState<RaiseCostPreviewResponse | null>(null);

  const lookupsQuery = useQuery({
    queryKey: ['lookups'],
    queryFn: fetchLookups,
    staleTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: previewRaiseCost,
    onSuccess: (data) => {
      setResult(data);
    },
  });

  // Auto-run if deep-linked with explicit query parameters (e.g., from Reports or Ask about pay)
  useEffect(() => {
    const urlPct = searchParams.get('raisePercent');
    if (urlPct) {
      const urlCountry = (searchParams.get('country') as CountryCode) || undefined;
      const urlDept = (searchParams.get('department') as DepartmentCode) || undefined;
      const urlLevel = (searchParams.get('level') as LevelCode) || undefined;
      try {
        parseRaisePercentToBasisPoints(urlPct);
        mutation.mutate({
          country: urlCountry,
          department: urlDept,
          level: urlLevel,
          raisePercent: urlPct.trim(),
        });
      } catch {
        // Let user fix invalid URL percentage in form
      }
    }
    // Run once on initial deep-link mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setValidationError(null);
    try {
      parseRaisePercentToBasisPoints(raisePercent);
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'Invalid raise percentage.');
      return;
    }

    const next = new URLSearchParams();
    if (country) next.set('country', country);
    if (department) next.set('department', department);
    if (level) next.set('level', level);
    next.set('raisePercent', raisePercent.trim());
    setSearchParams(next, { replace: true });

    mutation.mutate({
      country: country || undefined,
      department: department || undefined,
      level: level || undefined,
      raisePercent: raisePercent.trim(),
    });
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
            Raise-Cost Preview
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Estimate the annual base salary impact of a percentage raise on a filtered active
            cohort. Read-only — no employee records or salary history are modified.
          </Typography>
        </Box>
        <Chip label="Read-Only · Active Employees Only" color="secondary" variant="outlined" />
      </Stack>

      <Paper sx={{ p: 3 }}>
        <Box component="form" onSubmit={handleSubmit} noValidate>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            alignItems={{ md: 'flex-start' }}
            flexWrap="wrap"
            useFlexGap
          >
            <FormControl size="small" sx={{ minWidth: 165 }}>
              <InputLabel id="prev-country-label">Country</InputLabel>
              <Select
                labelId="prev-country-label"
                label="Country"
                value={country}
                onChange={(e) => setCountry(e.target.value as CountryCode | '')}
              >
                <MenuItem value="">All countries (USD)</MenuItem>
                {lookupsQuery.data?.countries.map((c) => (
                  <MenuItem key={c.code} value={c.code}>
                    {c.name} ({c.currencyCode})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 165 }}>
              <InputLabel id="prev-dept-label">Department</InputLabel>
              <Select
                labelId="prev-dept-label"
                label="Department"
                value={department}
                onChange={(e) => setDepartment(e.target.value as DepartmentCode | '')}
              >
                <MenuItem value="">All departments</MenuItem>
                {lookupsQuery.data?.departments.map((d) => (
                  <MenuItem key={d.code} value={d.code}>
                    {d.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 130 }}>
              <InputLabel id="prev-level-label">Level</InputLabel>
              <Select
                labelId="prev-level-label"
                label="Level"
                value={level}
                onChange={(e) => setLevel(e.target.value as LevelCode | '')}
              >
                <MenuItem value="">All levels</MenuItem>
                {lookupsQuery.data?.levels.map((l) => (
                  <MenuItem key={l.code} value={l.code}>
                    {l.code}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="Raise Percentage (%)"
              size="small"
              value={raisePercent}
              onChange={(e) => {
                setRaisePercent(e.target.value);
                setValidationError(null);
              }}
              placeholder="e.g. 5 or 3.5"
              helperText="0.01 to 100.00 (max 2 decimals)"
              sx={{ width: 210 }}
            />

            <Button
              type="submit"
              variant="contained"
              disabled={mutation.isPending || !raisePercent.trim()}
              sx={{ height: 40 }}
            >
              {mutation.isPending ? 'Calculating...' : 'Preview Raise Cost'}
            </Button>
          </Stack>
        </Box>
      </Paper>

      {mutation.isPending && <LinearProgress />}

      {validationError && <Alert severity="error">{validationError}</Alert>}

      {mutation.isError && (
        <Alert severity="error">
          {mutation.error instanceof ApiClientError
            ? mutation.error.message
            : 'Unable to calculate raise-cost preview.'}
        </Alert>
      )}

      {result && (
        <Stack spacing={2.5}>
          <Alert severity="info" icon={false}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              alignItems={{ sm: 'center' }}
              justifyContent="space-between"
              flexWrap="wrap"
              useFlexGap
            >
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  color="primary"
                  label={
                    result.conversionApplied
                      ? `Currency: ${result.currency} (FX Converted)`
                      : `Currency: ${result.currency} (Native — No Conversion)`
                  }
                />
                <Typography variant="body2">{result.definitions.currencyBasis}</Typography>
              </Stack>
              <Button
                variant="contained"
                size="small"
                component={RouterLink}
                to={result.directoryPath}
              >
                Open matching employees
              </Button>
            </Stack>
          </Alert>

          {result.headcount === 0 && (
            <Alert severity="warning">
              No active employees match these filters. Current, projected, and difference spend are
              zero.
            </Alert>
          )}

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <Card sx={{ flex: 1 }}>
              <CardContent>
                <Typography variant="caption" color="text.secondary">
                  Active Cohort Headcount
                </Typography>
                <Typography variant="h4" data-testid="preview-headcount" sx={{ mt: 0.5 }}>
                  {result.headcount.toLocaleString()}
                </Typography>
              </CardContent>
            </Card>
            <Card sx={{ flex: 1 }}>
              <CardContent>
                <Typography variant="caption" color="text.secondary">
                  Current Annual Base Spend
                </Typography>
                <Typography
                  variant="h5"
                  data-testid="preview-current-spend"
                  sx={{ mt: 0.5, fontFamily: 'monospace' }}
                >
                  {formatMoneyDisplay(result.currentAnnualSpend, result.currency)}
                </Typography>
              </CardContent>
            </Card>
            <Card sx={{ flex: 1 }}>
              <CardContent>
                <Typography variant="caption" color="text.secondary">
                  Projected Spend (+{result.raisePercent}%)
                </Typography>
                <Typography
                  variant="h5"
                  data-testid="preview-projected-spend"
                  sx={{ mt: 0.5, fontFamily: 'monospace' }}
                >
                  {formatMoneyDisplay(result.projectedAnnualSpend, result.currency)}
                </Typography>
              </CardContent>
            </Card>
            <Card sx={{ flex: 1, borderTop: '3px solid', borderColor: 'secondary.main' }}>
              <CardContent>
                <Typography variant="caption" color="text.secondary">
                  Estimated Annual Difference
                </Typography>
                <Typography
                  variant="h5"
                  color="secondary.main"
                  data-testid="preview-difference"
                  sx={{ mt: 0.5, fontFamily: 'monospace', fontWeight: 700 }}
                >
                  +{formatMoneyDisplay(result.differenceAnnualSpend, result.currency)}
                </Typography>
              </CardContent>
            </Card>
          </Stack>

          <Paper sx={{ p: 2.5 }} variant="outlined">
            <Typography variant="subtitle2" gutterBottom>
              Calculation Rules &amp; Read-Only Guarantee
            </Typography>
            <Stack spacing={0.5}>
              <Typography variant="body2" color="text.secondary">
                <strong>Population:</strong> {result.definitions.population}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <strong>Rounding:</strong> {result.definitions.calculation}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <strong>Write safety:</strong> {result.definitions.readOnly}
              </Typography>
            </Stack>
          </Paper>
        </Stack>
      )}
    </Stack>
  );
}
