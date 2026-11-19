import { Box, CircularProgress, CssBaseline, Paper, ThemeProvider, Typography } from '@mui/material';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { fetchSession } from './api/client';
import { AppShell } from './components/AppShell';
import { LoginPage } from './features/auth/LoginPage';
import { DirectoryPage } from './features/directory/DirectoryPage';
import { EmployeeDetailPage } from './features/employees/EmployeeDetailPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { appTheme } from './theme';

function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <Paper sx={{ p: 4 }}>
      <Typography variant="h5" gutterBottom>
        {title}
      </Typography>
      <Typography color="text.secondary">{description}</Typography>
    </Paper>
  );
}

function AuthenticatedRoutes() {
  const sessionQuery = useQuery({
    queryKey: ['session'],
    queryFn: fetchSession,
    staleTime: 60_000,
  });

  if (sessionQuery.isLoading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress aria-label="Loading session" />
      </Box>
    );
  }

  const session = sessionQuery.data;

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <AppShell session={session}>
      <Routes>
        <Route path="/employees" element={<DirectoryPage />} />
        <Route path="/employees/:id" element={<EmployeeDetailPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route
          path="/ask"
          element={
            <PlaceholderPage
              title="Ask About Pay"
              description="Plain-language compensation questions with report confirmation."
            />
          }
        />
        <Route path="/login" element={<Navigate to="/employees" replace />} />
        <Route path="*" element={<Navigate to="/employees" replace />} />
      </Routes>
    </AppShell>
  );
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function App() {
  const queryClient = createQueryClient();
  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthenticatedRoutes />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
