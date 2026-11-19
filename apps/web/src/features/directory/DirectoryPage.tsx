import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Pagination,
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
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  formatMoneyDisplay,
  type CountryCode,
  type DepartmentCode,
  type EmployeeSortField,
  type LevelCode,
} from '@acme/contracts';
import { fetchEmployees, fetchLookups } from '../../api/client';

export function DirectoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const urlSearch = searchParams.get('search') ?? '';
  const country = (searchParams.get('country') || undefined) as CountryCode | undefined;
  const department = (searchParams.get('department') || undefined) as DepartmentCode | undefined;
  const level = (searchParams.get('level') || undefined) as LevelCode | undefined;
  const status = (searchParams.get('status') || 'active') as 'active' | 'inactive' | 'all';
  const sortBy = (searchParams.get('sortBy') || 'employeeNumber') as EmployeeSortField;
  const sortDir = (searchParams.get('sortDir') || 'asc') as 'asc' | 'desc';
  const page = Math.max(1, Number(searchParams.get('page') || '1') || 1);
  const pageSize = 25;

  const [searchInput, setSearchInput] = useState(urlSearch);

  useEffect(() => {
    setSearchInput(urlSearch);
  }, [urlSearch]);

  function updateParams(patch: Record<string, string | undefined>, resetPage = true) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (!value) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }
    if (resetPage) {
      next.set('page', '1');
    }
    setSearchParams(next);
  }

  const lookupsQuery = useQuery({
    queryKey: ['lookups'],
    queryFn: fetchLookups,
    staleTime: 5 * 60_000,
  });

  const employeesQuery = useQuery({
    queryKey: ['employees', { urlSearch, country, department, level, status, sortBy, sortDir, page, pageSize }],
    queryFn: () =>
      fetchEmployees({
        search: urlSearch || undefined,
        country,
        department,
        level,
        status,
        sortBy,
        sortDir,
        page,
        pageSize,
      }),
  });

  const countryNames = new Map(lookupsQuery.data?.countries.map((c) => [c.code, c.name]) ?? []);
  const deptNames = new Map(lookupsQuery.data?.departments.map((d) => [d.code, d.name]) ?? []);

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2}>
        <Box>
          <Typography variant="h4" component="h1">
            Employee Directory
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Search and filter annual gross base salaries across ACME’s workforce.
          </Typography>
        </Box>
      </Stack>

      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} flexWrap="wrap" useFlexGap>
          <Box
            component="form"
            onSubmit={(e) => {
              e.preventDefault();
              updateParams({ search: searchInput.trim() || undefined }, true);
            }}
            sx={{ display: 'flex', gap: 1, flexGrow: 1, minWidth: 260 }}
          >
            <TextField
              label="Search name or employee #"
              size="small"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              fullWidth
            />
            <Button type="submit" variant="contained">
              Search
            </Button>
          </Box>

          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel id="filter-country-label">Country</InputLabel>
            <Select
              labelId="filter-country-label"
              label="Country"
              value={country ?? ''}
              onChange={(e) => updateParams({ country: e.target.value || undefined }, true)}
            >
              <MenuItem value="">All countries</MenuItem>
              {lookupsQuery.data?.countries.map((c) => (
                <MenuItem key={c.code} value={c.code}>
                  {c.name} ({c.currencyCode})
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel id="filter-dept-label">Department</InputLabel>
            <Select
              labelId="filter-dept-label"
              label="Department"
              value={department ?? ''}
              onChange={(e) => updateParams({ department: e.target.value || undefined }, true)}
            >
              <MenuItem value="">All departments</MenuItem>
              {lookupsQuery.data?.departments.map((d) => (
                <MenuItem key={d.code} value={d.code}>
                  {d.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel id="filter-level-label">Level</InputLabel>
            <Select
              labelId="filter-level-label"
              label="Level"
              value={level ?? ''}
              onChange={(e) => updateParams({ level: e.target.value || undefined }, true)}
            >
              <MenuItem value="">All levels</MenuItem>
              {lookupsQuery.data?.levels.map((l) => (
                <MenuItem key={l.code} value={l.code}>
                  {l.code}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel id="filter-status-label">Status</InputLabel>
            <Select
              labelId="filter-status-label"
              label="Status"
              value={status}
              onChange={(e) => updateParams({ status: e.target.value }, true)}
            >
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="inactive">Inactive</MenuItem>
              <MenuItem value="all">All</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="sort-by-label">Sort by</InputLabel>
            <Select
              labelId="sort-by-label"
              label="Sort by"
              value={`${sortBy}:${sortDir}`}
              onChange={(e) => {
                const [nextBy, nextDir] = e.target.value.split(':');
                updateParams({ sortBy: nextBy, sortDir: nextDir }, true);
              }}
            >
              <MenuItem value="employeeNumber:asc">Employee # (A–Z)</MenuItem>
              <MenuItem value="displayName:asc">Name (A–Z)</MenuItem>
              <MenuItem value="displayName:desc">Name (Z–A)</MenuItem>
              <MenuItem value="salary:desc">Native Salary (High–Low)</MenuItem>
              <MenuItem value="salary:asc">Native Salary (Low–High)</MenuItem>
              <MenuItem value="country:asc">Country</MenuItem>
              <MenuItem value="department:asc">Department</MenuItem>
              <MenuItem value="level:asc">Level</MenuItem>
            </Select>
          </FormControl>

          <Button
            variant="text"
            onClick={() => {
              setSearchInput('');
              setSearchParams(new URLSearchParams());
            }}
          >
            Reset
          </Button>
        </Stack>
      </Paper>

      {employeesQuery.isError && (
        <Alert severity="error">Failed to load employee directory. Please try again.</Alert>
      )}

      <Paper>
        {employeesQuery.isFetching && <LinearProgress />}
        <Box sx={{ px: 2, py: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {employeesQuery.data
              ? `Showing ${employeesQuery.data.items.length} of ${employeesQuery.data.pagination.totalCount.toLocaleString()} matching employees (${status})`
              : 'Loading directory...'}
          </Typography>
        </Box>

        <TableContainer>
          <Table size="small" aria-label="Employee directory">
            <TableHead>
              <TableRow>
                <TableCell>Employee #</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Country</TableCell>
                <TableCell>Department</TableCell>
                <TableCell>Level</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Annual Base Salary</TableCell>
                <TableCell align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {employeesQuery.data && employeesQuery.data.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      No employees match the selected filters.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {employeesQuery.data?.items.map((emp) => (
                <TableRow key={emp.id} hover>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{emp.employeeNumber}</TableCell>
                  <TableCell>{emp.displayName}</TableCell>
                  <TableCell>{countryNames.get(emp.countryCode) ?? emp.countryCode}</TableCell>
                  <TableCell>{deptNames.get(emp.departmentCode) ?? emp.departmentCode}</TableCell>
                  <TableCell>{emp.levelCode}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={emp.active ? 'Active' : 'Inactive'}
                      color={emp.active ? 'success' : 'default'}
                      variant={emp.active ? 'filled' : 'outlined'}
                    />
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                    {formatMoneyDisplay(emp.currentSalary, emp.salaryCurrency)}
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      component={RouterLink}
                      to={`/employees/${emp.id}`}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {employeesQuery.data && employeesQuery.data.pagination.totalPages > 1 && (
          <Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}>
            <Pagination
              color="primary"
              page={employeesQuery.data.pagination.page}
              count={employeesQuery.data.pagination.totalPages}
              onChange={(_e, nextPage) => updateParams({ page: String(nextPage) }, false)}
            />
          </Box>
        )}
      </Paper>
    </Stack>
  );
}
