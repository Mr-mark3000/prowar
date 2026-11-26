'use client';

import React, { useState } from 'react';
import { Droplets, ShieldCheck } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';

const DEMO_ACCOUNTS = [
  { label: 'Central Admin', email: 'admin@bloodnet.jh.gov.pilot', role: 'central_admin' },
  { label: 'Regional Authority', email: 'authority@jhsacs.pilot', role: 'regional_authority' },
  { label: 'Raj Hospital', email: 'staff@rajhospital.pilot', role: 'hospital_staff' },
  { label: 'RIMS Hospital', email: 'staff@rimshospital.pilot', role: 'hospital_staff' },
  { label: 'Red Cross Blood Bank', email: 'bb@redcrossranchi.pilot', role: 'blood_bank_staff' },
  { label: 'Life Savers Blood Bank', email: 'bb@lifesavers.pilot', role: 'blood_bank_staff' },
];

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('admin@bloodnet.jh.gov.pilot');
  const [password, setPassword] = useState('BloodNet@2026');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center text-white">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-red-600 shadow-lg">
            <Droplets className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">BloodNet AI</h1>
          <p className="mt-1 text-sm text-slate-400">
            Predictive Blood Supply &amp; Shortage Management • Ranchi Pilot
          </p>
        </div>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Staff Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Signing in...' : 'Sign In to Command Portal'}
            </Button>
          </form>

          <div className="mt-6 border-t border-slate-100 pt-4">
            <p className="mb-2 text-xs font-semibold text-slate-500">
              Quick Pilot Accounts (Password: <code className="text-slate-700">BloodNet@2026</code>)
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => {
                    setEmail(acc.email);
                    setPassword('BloodNet@2026');
                  }}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-xs hover:border-red-300 hover:bg-red-50/40"
                >
                  <div className="font-semibold text-slate-800">{acc.label}</div>
                  <div className="text-[10px] text-slate-500">{acc.role}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2 rounded-lg bg-slate-50 p-2.5 text-[11px] text-slate-600">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
            Decision-support system only. All inter-organization transfers require human approval.
          </div>
        </Card>
      </div>
    </div>
  );
}
