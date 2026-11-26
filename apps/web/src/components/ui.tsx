'use client';

import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 bg-white shadow-sm',
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

export function Badge({
  children,
  variant = 'neutral',
  className,
}: {
  children: React.ReactNode;
  variant?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'purple';
  className?: string;
}) {
  const styles: Record<string, string> = {
    neutral: 'bg-slate-100 text-slate-700 border-slate-200',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-800 border-amber-200',
    danger: 'bg-red-50 text-red-700 border-red-200',
    info: 'bg-sky-50 text-sky-700 border-sky-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        styles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

export function DataSourceBadge({ kind }: { kind: 'ACTUAL' | 'PREDICTED' | 'SIMULATED' }) {
  const map = {
    ACTUAL: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    PREDICTED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    SIMULATED: 'bg-amber-50 text-amber-800 border-amber-200',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase',
        map[kind]
      )}
    >
      {kind}
    </span>
  );
}

export function RiskBadge({ risk }: { risk: 'Low' | 'Medium' | 'High' | 'Critical' | string }) {
  const variant =
    risk === 'Critical'
      ? 'danger'
      : risk === 'High'
        ? 'warning'
        : risk === 'Medium'
          ? 'info'
          : 'success';
  return <Badge variant={variant}>{risk}</Badge>;
}

export function StatCard({
  label,
  value,
  sublabel,
  icon,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  icon?: React.ReactNode;
  tone?: 'default' | 'danger' | 'warning' | 'success';
}) {
  const toneBorder =
    tone === 'danger'
      ? 'border-l-4 border-l-red-500'
      : tone === 'warning'
        ? 'border-l-4 border-l-amber-500'
        : tone === 'success'
          ? 'border-l-4 border-l-emerald-500'
          : '';
  return (
    <Card className={cn('p-4', toneBorder)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1.5 text-2xl font-bold text-slate-900">{value}</p>
          {sublabel && <p className="mt-1 text-xs text-slate-500">{sublabel}</p>}
        </div>
        {icon && <div className="rounded-lg bg-slate-100 p-2 text-slate-600">{icon}</div>}
      </div>
    </Card>
  );
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
}) {
  const variants = {
    primary: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-50',
    danger: 'bg-rose-700 text-white hover:bg-rose-800 disabled:opacity-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
  };
  const sizes = {
    sm: 'px-2.5 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
  };
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
