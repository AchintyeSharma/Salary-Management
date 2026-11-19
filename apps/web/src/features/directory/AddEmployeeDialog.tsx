import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  COUNTRY_TO_CURRENCY,
  parseSalaryToMinor,
  type CountryCode,
  type DepartmentCode,
  type LevelCode,
  type LookupsResponse,
} from '@acme/contracts';
import { ApiClientError, createEmployee } from '../../api/client';

interface AddEmployeeDialogProps {
  open: boolean;
  onClose: () => void;
  lookups?: LookupsResponse;
}

export function AddEmployeeDialog({ open, onClose, lookups }: AddEmployeeDialogProps) {
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [countryCode, setCountryCode] = useState<CountryCode>('US');
  const [departmentCode, setDepartmentCode] = useState<DepartmentCode>('ENG');
  const [levelCode, setLevelCode] = useState<LevelCode>('L3');
  const [openingSalary, setOpeningSalary] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: createEmployee,
    onSuccess: async (created) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['employees'] }),
        queryClient.invalidateQueries({ queryKey: ['reports'] }),
      ]);
      onClose();
      navigate(`/employees/${created.id}`);
    },
  });

  const currency = COUNTRY_TO_CURRENCY[countryCode];

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setValidationError(null);
    try {
      parseSalaryToMinor(openingSalary);
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'Invalid opening salary.');
      return;
    }
    mutation.mutate({
      employeeNumber: employeeNumber.trim(),
      displayName: displayName.trim(),
      countryCode,
      departmentCode,
      levelCode,
      openingSalary: openingSalary.trim(),
    });
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle>Add Employee</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {validationError && <Alert severity="error">{validationError}</Alert>}
            {mutation.error && (
              <Alert
                severity="error"
                action={
                  employeeNumber.trim() ? (
                    <Button
                      color="inherit"
                      size="small"
                      component={RouterLink}
                      to={`/employees?search=${encodeURIComponent(employeeNumber.trim())}&status=all`}
                      onClick={onClose}
                    >
                      Look up #
                    </Button>
                  ) : undefined
                }
              >
                {mutation.error instanceof ApiClientError
                  ? mutation.error.message
                  : 'Unable to create employee. You can look up the employee number to check if it was saved.'}
              </Alert>
            )}

            <TextField
              label="Employee Number"
              placeholder="e.g. EMP-10001"
              value={employeeNumber}
              onChange={(e) => setEmployeeNumber(e.target.value)}
              required
              fullWidth
            />
            <TextField
              label="Display Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              fullWidth
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <FormControl fullWidth>
                <InputLabel id="add-country-label">Country</InputLabel>
                <Select
                  labelId="add-country-label"
                  label="Country"
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value as CountryCode)}
                >
                  {(lookups?.countries ?? []).map((c) => (
                    <MenuItem key={c.code} value={c.code}>
                      {c.name} ({c.currencyCode})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl fullWidth>
                <InputLabel id="add-dept-label">Department</InputLabel>
                <Select
                  labelId="add-dept-label"
                  label="Department"
                  value={departmentCode}
                  onChange={(e) => setDepartmentCode(e.target.value as DepartmentCode)}
                >
                  {(lookups?.departments ?? []).map((d) => (
                    <MenuItem key={d.code} value={d.code}>
                      {d.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl fullWidth>
                <InputLabel id="add-level-label">Level</InputLabel>
                <Select
                  labelId="add-level-label"
                  label="Level"
                  value={levelCode}
                  onChange={(e) => setLevelCode(e.target.value as LevelCode)}
                >
                  {(lookups?.levels ?? []).map((l) => (
                    <MenuItem key={l.code} value={l.code}>
                      {l.code}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>

            <TextField
              label={`Opening Annual Gross Base Salary (${currency})`}
              placeholder="e.g. 125000.00"
              helperText={`Stored in exact ${currency} minor units with up to 2 decimal places.`}
              value={openingSalary}
              onChange={(e) => setOpeningSalary(e.target.value)}
              required
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={
              mutation.isPending ||
              !employeeNumber.trim() ||
              !displayName.trim() ||
              !openingSalary.trim()
            }
          >
            {mutation.isPending ? 'Saving...' : 'Create Employee'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
