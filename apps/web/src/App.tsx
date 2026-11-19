import { Box, Container, Paper, Typography } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { BrowserRouter } from 'react-router-dom';
import { appTheme } from './theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Box sx={{ minHeight: '100vh', py: 6, bgcolor: 'background.default' }}>
            <Container maxWidth="md">
              <Paper sx={{ p: 4 }} elevation={1}>
                <Typography variant="h4" gutterBottom>
                  ACME Salary Management
                </Typography>
                <Typography color="text.secondary">
                  HR compensation workspace for 10,000 employees across multiple countries.
                </Typography>
              </Paper>
            </Container>
          </Box>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
