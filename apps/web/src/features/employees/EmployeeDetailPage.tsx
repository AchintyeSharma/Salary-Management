import {
  Alert,
  Box,
  Button,
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
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { formatMoneyDisplay } from '@acme/contracts';
import { fetchEmployeeDetail, fetchLookups } from '../../api/client';

export function EmployeeDetailPage() {
  const { id } = useParams();
  const employeeId = Number(id);

  const lookupsQuery = useQuery({
    queryKey: ['lookups'],
    queryFn: fetchLookups,
    staleTime: 5 * 60_000,
  });

  const detailQuery = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: () => fetchEmployeeDetail(employeeId),
    enabled: Number.isInteger(employeeId) && employeeId > 0,
  });

  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    return <Alert severity="error">Invalid employee ID.</Alert>;
  }

  if (detailQuery.isLoading) {
    return <LinearProgress />;
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <Stack spacing={2}>
        <Alert severity="error">Unable to load employee profile.</Alert>
        <Button component={RouterLink} to="/employees" variant="outlined" sx={{ alignSelf: 'flex-start' }}>
          Back to directory
        </Button>
      </Stack>
    );
  }

  const emp = detailQuery.data;
  const countryName =
    lookupsQuery.data?.countries.find((c) => c.code === emp.countryCode)?.name ?? emp.countryCode;
  const deptName =
    lookupsQuery.data?.departments.find((d) => d.code === emp.departmentCode)?.name ??
    emp.departmentCode;

  return (
    <Stack spacing={3}>
      <Box>
        <Button component={RouterLink} to="/employees" variant="text" size="small" sx={{ mb: 1 }}>
          ← Back to Directory
        </Button>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} justifyContent="space-between">
          <Box>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Typography variant="h4" component="h1">
                {emp.displayName}
              </Typography>
              <Chip
                label={emp.active ? 'Active' : 'Inactive'}
                color={emp.active ? 'success' : 'default'}
                size="small"
              />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
              {emp.employeeNumber} · Version {emp.version}
            </Typography>
          </Box>
          <Box sx={{ textAlign: { sm: 'right' } }}>
            <Typography variant="caption" color="text.secondary" display="block">
              Current Annual Gross Base Salary
            </Typography>
            <Typography variant="h5" sx={{ fontFamily: 'monospace' }}>
              {formatMoneyDisplay(emp.currentSalary, emp.salaryCurrency)}
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          Profile Details
        </Typography>
        <Divider sx={{ mb: 2 }} />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={4} flexWrap="wrap" useFlexGap>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Country
            </Typography>
            <Typography>{countryName}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Department
            </Typography>
            <Typography>{deptName}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Level
            </Typography>
            <Typography>{emp.levelCode}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Local Currency (Fixed)
            </Typography>
            <Typography>{emp.salaryCurrency}</Typography>
          </Box>
        </Stack>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          Salary Revision History ({emp.revisions.length})
        </Typography>
        <TableContainer>
          <Table size="small" aria-label="Salary revision history">
            <TableHead>
              <TableRow>
                <TableCell>Seq</TableCell>
                <TableCell align="right">Previous Salary</TableCell>
                <TableCell align="right">New Salary</TableCell>
                <TableCell>Reason</TableCell>
                <TableCell>Recorded By</TableCell>
                <TableCell>Recorded At (UTC)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {emp.revisions.map((rev) => (
                <TableRow key={rev.id}>
                  <TableCell>#{rev.sequence}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                    {rev.previousSalary
                      ? formatMoneyDisplay(rev.previousSalary, rev.currencyCode)
                      : '— (Opening)'}
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                    {formatMoneyDisplay(rev.newSalary, rev.currencyCode)}
                  </TableCell>
                  <TableCell>{rev.reasonCode}</TableCell>
                  <TableCell>{rev.actorDisplayName}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {rev.recordedAt.replace('T', ' ').slice(0, 19)} UTC
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Stack>
  );
}
