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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  formatMoneyDisplay,
  type CountryCode,
  type DepartmentCode,
  type LevelCode,
  type ReportGroupBy,
} from '@acme/contracts';
import { ApiClientError, fetchCompensationReport, fetchLookups } from '../../api/client';

export function buildDirectoryUrl(filters: {
  country?: string;
  department?: string;
  level?: string;
  status?: string;
}): string {
  const params = new URLSearchParams();
  if (filters.country) params.set('country', filters.country);
  if (filters.department) params.set('department', filters.department);
  if (filters.level) params.set('level', filters.level);
  if (filters.status) params.set('status', filters.status);
  return `/employees?${params.toString()}`;
}

export function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const country = (searchParams.get('country') || undefined) as CountryCode | undefined;
  const department = (searchParams.get('department') || undefined) as DepartmentCode | undefined;
  const level = (searchParams.get('level') || undefined) as LevelCode | undefined;
  const status = (searchParams.get('status') || 'active') as 'active' | 'inactive' | 'all';
  const groupBy = (searchParams.get('groupBy') || undefined) as ReportGroupBy | undefined;

  function updateParams(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (!value) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }
    setSearchParams(next);
  }

  const lookupsQuery = useQuery({
    queryKey: ['lookups'],
    queryFn: fetchLookups,
    staleTime: 5 * 60_000,
  });

  const reportQuery = useQuery({
    queryKey: ['reports', 'compensation', { country, department, level, status, groupBy }],
    queryFn: () =>
      fetchCompensationReport({
        country,
        department,
        level,
        status,
        groupBy,
      }),
  });

  const report = reportQuery.data;

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'center' }}
        spacing={2}
      >
        <Box>
          <Typography variant="h4" component="h1">
            Compensation Reports
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Exact headcount, total annual gross base salary, and median across ACME cohorts.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            component={RouterLink}
            to={buildDirectoryUrl({ country, department, level, status })}
          >
            Open matching employees
          </Button>
          <Button
            variant="contained"
            component={RouterLink}
            to={`/preview?${new URLSearchParams({
              ...(country ? { country } : {}),
              ...(department ? { department } : {}),
              ...(level ? { level } : {}),
              raisePercent: '5',
            }).toString()}`}
          >
            Preview raise
          </Button>
        </Stack>
      </Stack>

      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} flexWrap="wrap" useFlexGap alignItems={{ md: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="rep-country-label">Country</InputLabel>
            <Select
              labelId="rep-country-label"
              label="Country"
              value={country ?? ''}
              onChange={(e) => updateParams({ country: e.target.value || undefined })}
            >
              <MenuItem value="">All countries</MenuItem>
              {lookupsQuery.data?.countries.map((c) => (
                <MenuItem key={c.code} value={c.code}>
                  {c.name} ({c.currencyCode})
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="rep-dept-label">Department</InputLabel>
            <Select
              labelId="rep-dept-label"
              label="Department"
              value={department ?? ''}
              onChange={(e) => updateParams({ department: e.target.value || undefined })}
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
            <InputLabel id="rep-level-label">Level</InputLabel>
            <Select
              labelId="rep-level-label"
              label="Level"
              value={level ?? ''}
              onChange={(e) => updateParams({ level: e.target.value || undefined })}
            >
              <MenuItem value="">All levels</MenuItem>
              {lookupsQuery.data?.levels.map((l) => (
                <MenuItem key={l.code} value={l.code}>
                  {l.code}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 170 }}>
            <InputLabel id="rep-group-label">Group by</InputLabel>
            <Select
              labelId="rep-group-label"
              label="Group by"
              value={groupBy ?? ''}
              onChange={(e) => updateParams({ groupBy: e.target.value || undefined })}
            >
              <MenuItem value="">Overview only</MenuItem>
              <MenuItem value="country">Country</MenuItem>
              <MenuItem value="department">Department</MenuItem>
              <MenuItem value="level">Level</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel id="rep-status-label">Population</InputLabel>
            <Select
              labelId="rep-status-label"
              label="Population"
              value={status}
              onChange={(e) => updateParams({ status: e.target.value })}
            >
              <MenuItem value="active">Active (Default)</MenuItem>
              <MenuItem value="inactive">Inactive</MenuItem>
              <MenuItem value="all">All</MenuItem>
            </Select>
          </FormControl>

          <Button variant="text" onClick={() => setSearchParams(new URLSearchParams())}>
            Reset
          </Button>
        </Stack>
      </Paper>

      {reportQuery.isFetching && <LinearProgress />}

      {reportQuery.isError && (
        <Alert severity="error">
          {reportQuery.error instanceof ApiClientError
            ? reportQuery.error.message
            : 'Unable to calculate compensation report.'}
        </Alert>
      )}

      {report && (
        <>
          <Alert severity="info" icon={false}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} flexWrap="wrap" useFlexGap>
              <Chip
                size="small"
                color="primary"
                label={
                  report.conversionApplied
                    ? `Currency: ${report.currency} (FX Converted)`
                    : `Currency: ${report.currency} (Native — No Conversion)`
                }
              />
              <Typography variant="body2">
                {report.definitions.currencyBasis}
              </Typography>
            </Stack>
          </Alert>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <Card sx={{ flex: 1 }}>
              <CardContent>
                <Typography variant="caption" color="text.secondary">
                  Headcount ({report.filters.status})
                </Typography>
                <Typography variant="h4" data-testid="report-headcount" sx={{ mt: 0.5 }}>
                  {report.summary.headcount.toLocaleString()}
                </Typography>
              </CardContent>
            </Card>
            <Card sx={{ flex: 1 }}>
              <CardContent>
                <Typography variant="caption" color="text.secondary">
                  Total Annual Base Salary
                </Typography>
                <Typography
                  variant="h4"
                  data-testid="report-total"
                  sx={{ mt: 0.5, fontFamily: 'monospace' }}
                >
                  {formatMoneyDisplay(report.summary.totalAnnualBaseSalary, report.currency)}
                </Typography>
              </CardContent>
            </Card>
            <Card sx={{ flex: 1 }}>
              <CardContent>
                <Typography variant="caption" color="text.secondary">
                  Median Annual Base Salary
                </Typography>
                <Typography
                  variant="h4"
                  data-testid="report-median"
                  sx={{ mt: 0.5, fontFamily: 'monospace' }}
                >
                  {report.summary.medianAnnualBaseSalary !== null
                    ? formatMoneyDisplay(report.summary.medianAnnualBaseSalary, report.currency)
                    : '— (Empty cohort)'}
                </Typography>
              </CardContent>
            </Card>
          </Stack>

          {groupBy && (
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                Breakdown by {groupBy} ({report.currency})
              </Typography>
              <TableContainer>
                <Table size="small" aria-label="Grouped compensation breakdown">
                  <TableHead>
                    <TableRow>
                      <TableCell>{groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}</TableCell>
                      <TableCell align="right">Headcount</TableCell>
                      <TableCell align="right">Total Annual Base Salary</TableCell>
                      <TableCell align="right">Median Annual Base Salary</TableCell>
                      <TableCell align="right">Cohort</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.groups.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} align="center" sx={{ py: 3 }}>
                          <Typography color="text.secondary">
                            No matching employees in this cohort.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {report.groups.map((row) => {
                      const rowDirUrl = buildDirectoryUrl({
                        country: groupBy === 'country' ? row.key : country,
                        department: groupBy === 'department' ? row.key : department,
                        level: groupBy === 'level' ? row.key : level,
                        status,
                      });
                      return (
                        <TableRow key={row.key} hover>
                          <TableCell sx={{ fontWeight: 500 }}>{row.label}</TableCell>
                          <TableCell align="right">{row.headcount.toLocaleString()}</TableCell>
                          <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                            {formatMoneyDisplay(row.totalAnnualBaseSalary, report.currency)}
                          </TableCell>
                          <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                            {row.medianAnnualBaseSalary !== null
                              ? formatMoneyDisplay(row.medianAnnualBaseSalary, report.currency)
                              : '—'}
                          </TableCell>
                          <TableCell align="right">
                            <Button size="small" component={RouterLink} to={rowDirUrl}>
                              View employees
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}

          <Paper sx={{ p: 2.5 }} variant="outlined">
            <Typography variant="subtitle2" gutterBottom>
              Report Definitions
            </Typography>
            <Stack spacing={0.5}>
              <Typography variant="body2" color="text.secondary">
                <strong>Population:</strong> {report.definitions.population}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <strong>Total Annual Base Salary:</strong> {report.definitions.totalAnnualBaseSalary}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <strong>Median:</strong> {report.definitions.median}
              </Typography>
            </Stack>
          </Paper>
        </>
      )}
    </Stack>
  );
}
