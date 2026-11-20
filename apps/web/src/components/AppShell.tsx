import type { ReactNode } from 'react';
import {
  AppBar,
  Box,
  Button,
  Container,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import type { SessionInfo } from '@acme/contracts';
import { signOut } from '../api/client';

interface AppShellProps {
  session: SessionInfo;
  children: ReactNode;
}

const NAV_ITEMS = [
  { label: 'Employees', to: '/employees' },
  { label: 'Reports', to: '/reports' },
  { label: 'Ask about pay', to: '/ask' },
  { label: 'Raise Preview', to: '/preview' },
];

export function AppShell({ session, children }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const logoutMutation = useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={1}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography
            variant="h6"
            component={RouterLink}
            to="/employees"
            sx={{ color: 'inherit', textDecoration: 'none', mr: 2 }}
          >
            ACME Compensation
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexGrow: 1 }}>
            {NAV_ITEMS.map((item) => {
              const active = location.pathname.startsWith(item.to);
              return (
                <Button
                  key={item.to}
                  component={RouterLink}
                  to={item.to}
                  color="inherit"
                  variant={active ? 'outlined' : 'text'}
                  sx={{
                    borderColor: active ? 'rgba(255,255,255,0.6)' : 'transparent',
                    fontWeight: active ? 700 : 500,
                  }}
                >
                  {item.label}
                </Button>
              );
            })}
          </Stack>
          <Typography variant="body2" sx={{ display: { xs: 'none', sm: 'block' } }}>
            {session.account.displayName}
          </Typography>
          <Button
            color="inherit"
            variant="outlined"
            size="small"
            disabled={logoutMutation.isPending}
            onClick={() => logoutMutation.mutate()}
            sx={{ borderColor: 'rgba(255,255,255,0.5)' }}
          >
            Sign out
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="xl" sx={{ py: 3, flexGrow: 1 }}>
        {children}
      </Container>
    </Box>
  );
}
