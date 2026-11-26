'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, UserProfile, UserRole } from './api';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function getDefaultRouteForRole(role: UserRole): string {
  switch (role) {
    case 'central_admin':
    case 'regional_authority':
      return '/dashboard/admin';
    case 'hospital_staff':
      return '/dashboard/hospital';
    case 'blood_bank_staff':
      return '/dashboard/blood-bank';
    default:
      return '/dashboard/admin';
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refreshMe = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('bloodnet_token') : null;
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await apiFetch<{ user: UserProfile }>('/api/auth/me');
      setUser(res.user);
    } catch {
      localStorage.removeItem('bloodnet_token');
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  const login = async (email: string, password: string) => {
    const res = await apiFetch<{ token: string; user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem('bloodnet_token', res.token);
    setUser(res.user);
    router.push(getDefaultRouteForRole(res.user.role));
  };

  const logout = () => {
    localStorage.removeItem('bloodnet_token');
    setUser(null);
    router.push('/login');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
