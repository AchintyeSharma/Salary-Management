import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
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
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  formatMoneyDisplay,
  parseSalaryToMinor,
  type CurrencyCode,
  type DepartmentCode,
  type EmployeeSummaryDto,
  type LevelCode,
  type RevisionReasonCode,
} from '@acme/contracts';
import {
  ApiClientError,
  createSalaryRevision,
  fetchEmployeeDetail,
  fetchLookups,
  patchEmployee,
} from '../../api/client';

function generateRequestKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `rev_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `rev_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

interface PendingRevisionSnapshot {
  employeeId: number;
  expectedVersion: number;
  reviewedCurrentSalary: string;
  proposedSalary: string;
  currencyCode: CurrencyCode;
  reasonCode: Exclude<RevisionReasonCode, 'HIRE'>;
  requestKey: string;
}

export function EmployeeDetailPage() {
  const { id } = useParams();
  const employeeId = Number(id);
  const queryClient = useQueryClient();

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

  const emp = detailQuery.data;

  // Profile edit state
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDepartment, setEditDepartment] = useState<DepartmentCode>('ENG');
  const [editLevel, setEditLevel] = useState<LevelCode>('L1');

  // Status toggle confirmation state
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);

  // Salary revision form state & frozen confirmation snapshot
  const [newSalary, setNewSalary] = useState('');
  const [reasonCode, setReasonCode] =
    useState<Exclude<RevisionReasonCode, 'HIRE'>>('MERIT');
  const [requestKey, setRequestKey] = useState<string>(() => generateRequestKey());
  const [confirmRevisionOpen, setConfirmRevisionOpen] = useState(false);
  const [pendingRevision, setPendingRevision] = useState<PendingRevisionSnapshot | null>(null);
  const [revisionValidationError, setRevisionValidationError] = useState<string | null>(null);

  // Feedback banners
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [conflictEmployee, setConflictEmployee] = useState<EmployeeSummaryDto | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  useEffect(() => {
    if (emp) {
      setEditName(emp.displayName);
      setEditDepartment(emp.departmentCode);
      setEditLevel(emp.levelCode);
    }
  }, [emp]);

  async function refreshAllAfterMutation() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['employee', employeeId] }),
      queryClient.invalidateQueries({ queryKey: ['employees'] }),
      queryClient.invalidateQueries({ queryKey: ['reports'] }),
    ]);
  }

  function handleMutationError(err: unknown) {
    setSuccessMessage(null);
    if (err instanceof ApiClientError) {
      setErrorBanner(err.message);
      const latest = err.details?.currentEmployee as EmployeeSummaryDto | undefined;
      if (err.status === 409 && latest) {
        setConflictEmployee(latest);
      } else {
        setConflictEmployee(null);
      }
      return;
    }
    setErrorBanner('Operation failed. You can retry safely.');
  }

  const profileMutation = useMutation({
    mutationFn: (payload: {
      expectedVersion: number;
      displayName?: string;
      departmentCode?: DepartmentCode;
      levelCode?: LevelCode;
      active?: boolean;
    }) => patchEmployee(employeeId, payload),
    onSuccess: async (updated, variables) => {
      setErrorBanner(null);
      setConflictEmployee(null);
      setEditProfileOpen(false);
      setStatusDialogOpen(false);
      queryClient.setQueryData(['employee', employeeId], updated);
      await refreshAllAfterMutation();
      if (variables.active !== undefined) {
        setSuccessMessage(
          updated.active
            ? 'Employee reactivated. They are now included in active reports and eligible for salary revisions.'
            : 'Employee deactivated. They are now excluded from active reports and salary history is preserved.',
        );
      } else {
        setSuccessMessage('Employee profile updated. Salary history was left unchanged.');
      }
    },
    onError: (err) => {
      setEditProfileOpen(false);
      setStatusDialogOpen(false);
      handleMutationError(err);
    },
  });

  const revisionMutation = useMutation({
    mutationFn: (snapshot: PendingRevisionSnapshot) =>
      createSalaryRevision(snapshot.employeeId, {
        expectedVersion: snapshot.expectedVersion,
        newSalary: snapshot.proposedSalary,
        reasonCode: snapshot.reasonCode,
        requestKey: snapshot.requestKey,
      }),
    onSuccess: async (result) => {
      setConfirmRevisionOpen(false);
      setPendingRevision(null);
      setErrorBanner(null);
      setConflictEmployee(null);
      setRevisionValidationError(null);
      setNewSalary('');
      setRequestKey(generateRequestKey());
      queryClient.setQueryData(['employee', employeeId], result.employee);
      await refreshAllAfterMutation();
      setSuccessMessage(
        result.replayed
          ? `Returned previously saved revision #${result.revision.sequence}.`
          : `Saved salary revision #${result.revision.sequence} (${formatMoneyDisplay(result.revision.newSalary, result.revision.currencyCode)}).`,
      );
    },
    onError: (err) => {
      // On 409 conflict, close modal and clear snapshot so HR must review latest data before retrying
      if (err instanceof ApiClientError && err.status === 409) {
        setConfirmRevisionOpen(false);
        setPendingRevision(null);
      }
      handleMutationError(err);
    },
  });

  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    return <Alert severity="error">Invalid employee ID.</Alert>;
  }

  if (detailQuery.isLoading) {
    return <LinearProgress />;
  }

  if (detailQuery.isError || !emp) {
    return (
      <Stack spacing={2}>
        <Alert severity="error">Unable to load employee profile.</Alert>
        <Button
          component={RouterLink}
          to="/employees"
          variant="outlined"
          sx={{ alignSelf: 'flex-start' }}
        >
          Back to directory
        </Button>
      </Stack>
    );
  }

  const countryName =
    lookupsQuery.data?.countries.find((c) => c.code === emp.countryCode)?.name ?? emp.countryCode;
  const deptName =
    lookupsQuery.data?.departments.find((d) => d.code === emp.departmentCode)?.name ??
    emp.departmentCode;

  function handleRevisionReview(event: FormEvent) {
    event.preventDefault();
    setRevisionValidationError(null);
    setSuccessMessage(null);
    setErrorBanner(null);
    setConflictEmployee(null);
    try {
      const parsedNew = parseSalaryToMinor(newSalary);
      const parsedCurrent = parseSalaryToMinor(emp!.currentSalary);
      if (parsedNew === parsedCurrent) {
        setRevisionValidationError('New salary must differ from the current salary.');
        return;
      }
      setPendingRevision({
        employeeId: emp!.id,
        expectedVersion: emp!.version,
        reviewedCurrentSalary: emp!.currentSalary,
        proposedSalary: newSalary.trim(),
        currencyCode: emp!.salaryCurrency as CurrencyCode,
        reasonCode,
        requestKey: requestKey || generateRequestKey(),
      });
      setConfirmRevisionOpen(true);
    } catch (err) {
      setRevisionValidationError(
        err instanceof Error ? err.message : 'Please enter a valid positive salary.',
      );
    }
  }

  function handleReloadLatest() {
    setConflictEmployee(null);
    setErrorBanner(null);
    setRequestKey(generateRequestKey());
    detailQuery.refetch();
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Button component={RouterLink} to="/employees" variant="text" size="small" sx={{ mb: 1 }}>
          ← Back to Directory
        </Button>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ sm: 'center' }}
          justifyContent="space-between"
        >
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

      {successMessage && (
        <Alert severity="success" onClose={() => setSuccessMessage(null)}>
          {successMessage}
        </Alert>
      )}

      {errorBanner && (
        <Alert
          severity={conflictEmployee ? 'warning' : 'error'}
          action={
            conflictEmployee ? (
              <Button color="inherit" size="small" onClick={handleReloadLatest}>
                Reload latest
              </Button>
            ) : undefined
          }
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {errorBanner}
          </Typography>
          {conflictEmployee && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              Latest saved record: {conflictEmployee.displayName} · {conflictEmployee.departmentCode}{' '}
              · {conflictEmployee.levelCode} · {conflictEmployee.active ? 'Active' : 'Inactive'} ·{' '}
              {formatMoneyDisplay(conflictEmployee.currentSalary, conflictEmployee.salaryCurrency)}{' '}
              (Version {conflictEmployee.version})
            </Typography>
          )}
        </Alert>
      )}

      <Paper sx={{ p: 3 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ sm: 'center' }}
          spacing={2}
          sx={{ mb: 2 }}
        >
          <Typography variant="h6">Profile Details</Typography>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                setEditName(emp.displayName);
                setEditDepartment(emp.departmentCode);
                setEditLevel(emp.levelCode);
                setEditProfileOpen(true);
              }}
            >
              Edit profile
            </Button>
            <Button
              variant="outlined"
              color={emp.active ? 'warning' : 'success'}
              size="small"
              onClick={() => setStatusDialogOpen(true)}
            >
              {emp.active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </Stack>
        </Stack>
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
          Record Immediate Salary Revision
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Enter the new annual gross base salary in {emp.salaryCurrency}. Current salary:{' '}
          <strong>{formatMoneyDisplay(emp.currentSalary, emp.salaryCurrency)}</strong>.
        </Typography>

        {!emp.active && (
          <Alert severity="info" sx={{ mb: 2 }}>
            This employee is inactive. Reactivate the employee before recording a new salary
            revision.
          </Alert>
        )}

        {revisionValidationError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {revisionValidationError}
          </Alert>
        )}

        <Box component="form" onSubmit={handleRevisionReview} noValidate>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'flex-start' }}>
            <TextField
              label={`New Annual Base Salary (${emp.salaryCurrency})`}
              placeholder="e.g. 3850000.00"
              value={newSalary}
              onChange={(e) => {
                setNewSalary(e.target.value);
                setRevisionValidationError(null);
                setRequestKey(generateRequestKey());
              }}
              disabled={!emp.active || revisionMutation.isPending}
              sx={{ minWidth: 260 }}
              size="small"
            />
            <FormControl size="small" sx={{ minWidth: 220 }} disabled={!emp.active}>
              <InputLabel id="revision-reason-label">Reason</InputLabel>
              <Select
                labelId="revision-reason-label"
                label="Reason"
                value={reasonCode}
                onChange={(e) => {
                  setReasonCode(e.target.value as Exclude<RevisionReasonCode, 'HIRE'>);
                  setRequestKey(generateRequestKey());
                }}
              >
                {(lookupsQuery.data?.revisionReasons ?? [
                  { code: 'MERIT', name: 'Merit Increase' },
                  { code: 'PROMOTION', name: 'Promotion' },
                  { code: 'MARKET_ADJUSTMENT', name: 'Market Adjustment' },
                  { code: 'ANNUAL_REVIEW', name: 'Annual Review' },
                  { code: 'CORRECTION', name: 'Data Correction' },
                ]).map((r) => (
                  <MenuItem key={r.code} value={r.code}>
                    {r.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              type="submit"
              variant="contained"
              disabled={!emp.active || !newSalary.trim() || revisionMutation.isPending}
            >
              Review &amp; Save Revision
            </Button>
          </Stack>
        </Box>
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

      {/* Edit Profile Dialog */}
      <Dialog open={editProfileOpen} onClose={() => setEditProfileOpen(false)} maxWidth="xs" fullWidth>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            profileMutation.mutate({
              expectedVersion: emp.version,
              displayName: editName.trim(),
              departmentCode: editDepartment,
              levelCode: editLevel,
            });
          }}
        >
          <DialogTitle>Edit Employee Profile</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                label="Display Name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
                fullWidth
              />
              <FormControl fullWidth>
                <InputLabel id="edit-dept-label">Department</InputLabel>
                <Select
                  labelId="edit-dept-label"
                  label="Department"
                  value={editDepartment}
                  onChange={(e) => setEditDepartment(e.target.value as DepartmentCode)}
                >
                  {(lookupsQuery.data?.departments ?? []).map((d) => (
                    <MenuItem key={d.code} value={d.code}>
                      {d.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel id="edit-level-label">Level</InputLabel>
                <Select
                  labelId="edit-level-label"
                  label="Level"
                  value={editLevel}
                  onChange={(e) => setEditLevel(e.target.value as LevelCode)}
                >
                  {(lookupsQuery.data?.levels ?? []).map((l) => (
                    <MenuItem key={l.code} value={l.code}>
                      {l.code}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditProfileOpen(false)}>Cancel</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={profileMutation.isPending || !editName.trim()}
            >
              Save profile
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Deactivate / Reactivate Confirmation Dialog */}
      <Dialog open={statusDialogOpen} onClose={() => setStatusDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{emp.active ? 'Deactivate Employee?' : 'Reactivate Employee?'}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {emp.active
              ? `Deactivating ${emp.displayName} (${emp.employeeNumber}) will exclude them from active compensation reports and block new salary revisions. Their salary history will remain intact.`
              : `Reactivating ${emp.displayName} (${emp.employeeNumber}) will restore them to active compensation reports and allow new salary revisions while retaining all salary history.`}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatusDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color={emp.active ? 'warning' : 'success'}
            disabled={profileMutation.isPending}
            onClick={() =>
              profileMutation.mutate({
                expectedVersion: emp.version,
                active: !emp.active,
              })
            }
          >
            {emp.active ? 'Confirm Deactivate' : 'Confirm Reactivate'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirm Salary Revision Dialog with frozen snapshot */}
      {pendingRevision && (
        <Dialog
          open={confirmRevisionOpen}
          onClose={() => {
            if (!revisionMutation.isPending) {
              setConfirmRevisionOpen(false);
              setPendingRevision(null);
            }
          }}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>Confirm Salary Revision</DialogTitle>
          <DialogContent>
            {revisionMutation.isError &&
              !(
                revisionMutation.error instanceof ApiClientError &&
                revisionMutation.error.status === 409
              ) && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {revisionMutation.error instanceof ApiClientError
                    ? revisionMutation.error.message
                    : 'Operation failed. You can retry safely.'}
                </Alert>
              )}
            <Stack spacing={1.5} sx={{ mt: 0.5 }}>
              <Typography variant="body2">
                Employee: <strong>{emp.displayName}</strong> ({emp.employeeNumber})
              </Typography>
              <Typography variant="body2">
                Current salary:{' '}
                <strong>
                  {formatMoneyDisplay(
                    pendingRevision.reviewedCurrentSalary,
                    pendingRevision.currencyCode,
                  )}
                </strong>
              </Typography>
              <Typography variant="body2">
                Proposed salary:{' '}
                <strong>
                  {formatMoneyDisplay(
                    pendingRevision.proposedSalary.includes('.')
                      ? pendingRevision.proposedSalary
                      : `${pendingRevision.proposedSalary}.00`,
                    pendingRevision.currencyCode,
                  )}
                </strong>
              </Typography>
              <Typography variant="body2">
                Reason: <strong>{pendingRevision.reasonCode}</strong>
              </Typography>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setConfirmRevisionOpen(false);
                setPendingRevision(null);
              }}
              disabled={revisionMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              disabled={revisionMutation.isPending}
              onClick={() => revisionMutation.mutate(pendingRevision)}
            >
              {revisionMutation.isPending ? 'Saving...' : 'Confirm & Save'}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}
