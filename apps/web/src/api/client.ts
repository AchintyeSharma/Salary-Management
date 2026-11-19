import type {
  EmployeeDetailDto,
  EmployeeListQuery,
  EmployeeListResponse,
  LoginRequest,
  LookupsResponse,
  SessionInfo,
} from '@acme/contracts';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const err = payload?.error;
    throw new ApiClientError(
      response.status,
      err?.code ?? 'REQUEST_FAILED',
      err?.message ?? `Request failed with status ${response.status}`,
      err?.details,
    );
  }

  return payload as T;
}

export function fetchSession(): Promise<SessionInfo | null> {
  return apiRequest<SessionInfo>('/api/session').catch((err) => {
    if (err instanceof ApiClientError && err.status === 401) {
      return null;
    }
    throw err;
  });
}

export function signIn(body: LoginRequest): Promise<SessionInfo> {
  return apiRequest<SessionInfo>('/api/session', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function signOut(): Promise<void> {
  return apiRequest<void>('/api/session', {
    method: 'DELETE',
  });
}

export function fetchLookups(): Promise<LookupsResponse> {
  return apiRequest<LookupsResponse>('/api/lookups');
}

export function fetchEmployees(query: Partial<EmployeeListQuery>): Promise<EmployeeListResponse> {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.country) params.set('country', query.country);
  if (query.department) params.set('department', query.department);
  if (query.level) params.set('level', query.level);
  if (query.status) params.set('status', query.status);
  if (query.sortBy) params.set('sortBy', query.sortBy);
  if (query.sortDir) params.set('sortDir', query.sortDir);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  return apiRequest<EmployeeListResponse>(`/api/employees?${params.toString()}`);
}

export function fetchEmployeeDetail(id: number): Promise<EmployeeDetailDto> {
  return apiRequest<EmployeeDetailDto>(`/api/employees/${id}`);
}
