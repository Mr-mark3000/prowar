'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getDefaultRouteForRole, useAuth } from '@/lib/auth-context';

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (user) {
      router.replace(getDefaultRouteForRole(user.role));
    } else {
      router.replace('/login');
    }
  }, [user, loading, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
      Redirecting to BloodNet AI...
    </div>
  );
}
