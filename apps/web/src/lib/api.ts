const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export type UserRole =
  | 'central_admin'
  | 'regional_authority'
  | 'hospital_staff'
  | 'blood_bank_staff';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  organization_id: string | null;
  organization_name: string | null;
  organization_type: string | null;
  organization_code: string | null;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('bloodnet_token');
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data.error || 'Request failed', data.code);
  }
  return data as T;
}

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export const BLOOD_COMPONENTS = ['rbc', 'platelets', 'plasma', 'whole_blood'] as const;

export const COMPONENT_LABELS: Record<string, string> = {
  rbc: 'RBC (42d)',
  platelets: 'Platelets (5d)',
  plasma: 'Plasma (365d)',
  whole_blood: 'Whole Blood (35d)',
};
