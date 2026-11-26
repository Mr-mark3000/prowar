'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  Droplets,
  LogOut,
  MapPin,
  ShieldAlert,
  Warehouse,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Badge, cn } from './ui';

interface NotificationRow {
  id: string;
  title: string;
  message: string;
  severity: string;
  is_read: boolean;
  created_at: string;
}

export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [showNotif, setShowNotif] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    apiFetch<{ notifications: NotificationRow[] }>('/api/notifications')
      .then((d) => setNotifications(d.notifications))
      .catch(() => {});
  }, [user, pathname]);

  const markRead = async (id: string) => {
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
    } catch {
      // ignore
    }
  };

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-500">Loading BloodNet AI Command...</div>
      </div>
    );
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const navItems = [
    {
      href: '/dashboard/admin',
      label: 'Central Admin',
      icon: Activity,
      roles: ['central_admin', 'regional_authority'],
    },
    {
      href: '/dashboard/hospital',
      label: 'Hospital Desk',
      icon: Building2,
      roles: ['central_admin', 'hospital_staff'],
    },
    {
      href: '/dashboard/blood-bank',
      label: 'Blood Bank Ops',
      icon: Warehouse,
      roles: ['central_admin', 'blood_bank_staff'],
    },
    {
      href: '/dashboard/analytics',
      label: 'Predictive Analytics',
      icon: BarChart3,
      roles: ['central_admin', 'regional_authority', 'hospital_staff', 'blood_bank_staff'],
    },
    {
      href: '/dashboard/map',
      label: 'Geo-Intelligence Map',
      icon: MapPin,
      roles: ['central_admin', 'regional_authority', 'hospital_staff', 'blood_bank_staff'],
    },
  ].filter((item) => item.roles.includes(user.role));

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="hidden w-64 flex-col border-r border-slate-200 bg-slate-900 text-slate-100 md:flex">
        <div className="flex items-center gap-2.5 border-b border-slate-800 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600 text-white">
            <Droplets className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight">BloodNet AI</div>
            <div className="text-[11px] text-slate-400">Ranchi Pilot Network</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-red-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 p-4 text-xs text-slate-400 space-y-2">
          <div className="rounded-lg bg-slate-800/80 p-2.5">
            <div className="flex items-center gap-1.5 font-semibold text-amber-300">
              <ShieldAlert className="h-3.5 w-3.5" />
              Decision-Support Only
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              Human approval required for all transfers. Zero patient PII stored.
            </p>
          </div>
          <div className="pt-1">
            <div className="font-medium text-slate-200 truncate">{user.full_name}</div>
            <div className="text-[11px] text-slate-400 truncate">
              {user.organization_name || 'Regional Command'}
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">{title}</h1>
            {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
          </div>

          <div className="flex items-center gap-3">
            <Badge variant="info">{user.role.replace('_', ' ')}</Badge>

            <div className="relative">
              <button
                onClick={() => setShowNotif((v) => !v)}
                className="relative rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
                title="Notifications"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                    {unreadCount}
                  </span>
                )}
              </button>

              {showNotif && (
                <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-xl z-50">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800">
                      Notifications ({unreadCount} unread)
                    </span>
                    <button
                      onClick={() => setShowNotif(false)}
                      className="text-xs text-slate-400 hover:text-slate-600"
                    >
                      Close
                    </button>
                  </div>
                  <div className="max-h-72 space-y-2 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="text-xs text-slate-400 py-4 text-center">No notifications</p>
                    ) : (
                      notifications.slice(0, 10).map((n) => (
                        <div
                          key={n.id}
                          onClick={() => !n.is_read && markRead(n.id)}
                          className={cn(
                            'cursor-pointer rounded-lg border p-2 text-xs',
                            n.is_read
                              ? 'border-slate-100 bg-slate-50 text-slate-500'
                              : 'border-red-200 bg-red-50/40 text-slate-800'
                          )}
                        >
                          <div className="font-semibold">{n.title}</div>
                          <div className="mt-0.5 text-[11px]">{n.message}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={logout}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
