'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Droplets,
  PackagePlus,
  Truck,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AppShell } from '@/components/AppShell';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataSourceBadge,
  RiskBadge,
  StatCard,
} from '@/components/ui';
import { apiFetch, BLOOD_COMPONENTS, BLOOD_GROUPS, COMPONENT_LABELS } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

interface OrgOption {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface InventoryRow {
  blood_group: string;
  component: string;
  available_units: number;
  reserved_units: number;
  expiring_within_7d_units: number;
  safety_stock_units: number;
}

interface ExpiringUnit {
  id: string;
  unit_code: string;
  blood_group: string;
  component: string;
  expiry_date: string;
  days_until_expiry: number;
}

interface BloodRequest {
  id: string;
  request_code: string;
  blood_group: string;
  component: string;
  units_requested: number;
  units_fulfilled: number;
  urgency: string;
  status: string;
  required_by: string;
}

interface TransferRow {
  id: string;
  transfer_code: string;
  source_org_name: string;
  blood_group: string;
  component: string;
  units_count: number;
  approval_status: string;
  distance_km: number;
  eta_minutes: number;
}

interface MatchRow {
  source_org_id: string;
  name: string;
  blood_group: string;
  component: string;
  available_units: number;
  surplus_units: number;
  distance_km: number;
  eta_minutes: number;
}

export default function HospitalDashboard() {
  const { user } = useAuth();
  const [hospitals, setHospitals] = useState<OrgOption[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [expiring, setExpiring] = useState<ExpiringUnit[]>([]);
  const [requests, setRequests] = useState<BloodRequest[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [forecast, setForecast] = useState<
    { target_date: string; predicted_demand: number; lower_bound: number; upper_bound: number }[]
  >([]);
  const [avgDailyUsage, setAvgDailyUsage] = useState<number>(0);
  const [horizon, setHorizon] = useState<7 | 30>(7);
  const [matches, setMatches] = useState<{ requestId: string; rows: MatchRow[] } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Forms
  const [consForm, setConsForm] = useState({
    blood_group: 'O-',
    component: 'rbc',
    units_used: '1',
    emergency_flag: false,
    notes: '',
  });
  const [reqForm, setReqForm] = useState({
    blood_group: 'O-',
    component: 'rbc',
    units_requested: '4',
    urgency: 'urgent',
    notes: '',
  });

  useEffect(() => {
    apiFetch<{ organizations: OrgOption[] }>('/api/organizations?type=hospital')
      .then((res) => {
        setHospitals(res.organizations);
        if (user?.organization_id && user.role === 'hospital_staff') {
          setSelectedOrgId(user.organization_id);
        } else if (res.organizations.length > 0) {
          const raj = res.organizations.find((o) => o.code === 'HOSP-RAJ');
          setSelectedOrgId(raj ? raj.id : res.organizations[0].id);
        }
      })
      .catch(() => {});
  }, [user]);

  const loadHospitalData = useCallback(async () => {
    if (!selectedOrgId) return;
    try {
      const [invRes, expRes, reqRes, trRes, analyticsRes] = await Promise.all([
        apiFetch<{ inventory: InventoryRow[] }>(`/api/inventory?organization_id=${selectedOrgId}`),
        apiFetch<{ expiring_units: ExpiringUnit[] }>(
          `/api/inventory/expiring?organization_id=${selectedOrgId}&days=7`
        ),
        apiFetch<{ requests: BloodRequest[] }>(`/api/requests?organization_id=${selectedOrgId}`),
        apiFetch<{ transfers: TransferRow[] }>(`/api/transfers?org_id=${selectedOrgId}`),
        apiFetch<{
          daily_actual: { actual_units: number }[];
          forecast_series: {
            target_date: string;
            predicted_demand: number;
            lower_bound: number;
            upper_bound: number;
          }[];
        }>(`/api/analytics/overview?organization_id=${selectedOrgId}&horizon=${horizon}`),
      ]);
      setInventory(invRes.inventory);
      setExpiring(expRes.expiring_units);
      setRequests(reqRes.requests);
      setTransfers(trRes.transfers);
      setForecast(analyticsRes.forecast_series);
      const recent = analyticsRes.daily_actual.slice(-14);
      const mean =
        recent.length > 0
          ? recent.reduce((s, r) => s + r.actual_units, 0) / recent.length
          : 5;
      setAvgDailyUsage(mean);
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Failed to load hospital data');
    }
  }, [selectedOrgId, horizon]);

  useEffect(() => {
    loadHospitalData();
  }, [loadHospitalData]);

  const handleRecordConsumption = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await apiFetch<{ consumed_units: string[]; threshold_check: { riskLevel: string } | null }>(
        '/api/consumption',
        {
          method: 'POST',
          body: JSON.stringify({
            organization_id: selectedOrgId,
            blood_group: consForm.blood_group,
            component: consForm.component,
            units_used: Number(consForm.units_used),
            emergency_flag: consForm.emergency_flag,
            notes: consForm.notes || undefined,
          }),
        }
      );
      setFeedback(
        `Consumed ${res.consumed_units.join(', ')} (FEFO). Current threshold risk: ${res.threshold_check?.riskLevel || 'Low'}`
      );
      loadHospitalData();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to record consumption');
    }
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await apiFetch<{ request: BloodRequest }>('/api/requests', {
        method: 'POST',
        body: JSON.stringify({
          requesting_org_id: selectedOrgId,
          blood_group: reqForm.blood_group,
          component: reqForm.component,
          units_requested: Number(reqForm.units_requested),
          urgency: reqForm.urgency,
          notes: reqForm.notes || undefined,
        }),
      });
      setFeedback(`Blood request ${res.request.request_code} created.`);
      loadHospitalData();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to create blood request');
    }
  };

  const loadMatches = async (reqId: string) => {
    const res = await apiFetch<{ matches: MatchRow[] }>(`/api/requests/${reqId}/matches`);
    setMatches({ requestId: reqId, rows: res.matches });
  };

  const proposeTransfer = async (match: MatchRow, reqObj: BloodRequest) => {
    const qty = Math.min(match.available_units, Math.max(1, reqObj.units_requested - reqObj.units_fulfilled));
    await apiFetch('/api/transfers', {
      method: 'POST',
      body: JSON.stringify({
        source_org_id: match.source_org_id,
        target_org_id: selectedOrgId,
        request_id: reqObj.id,
        blood_group: match.blood_group,
        component: match.component,
        units_count: qty,
      }),
    });
    setFeedback(`Transfer proposal submitted to ${match.name} (pending blood bank approval).`);
    setMatches(null);
    loadHospitalData();
  };

  const confirmReceipt = async (transferId: string) => {
    await apiFetch(`/api/transfers/${transferId}/complete`, { method: 'POST' });
    setFeedback('Transfer receipt confirmed and units added to hospital stock.');
    loadHospitalData();
  };

  const totalAvail = inventory.reduce((s, i) => s + i.available_units, 0);
  const lowBuckets = inventory.filter((i) => i.available_units < i.safety_stock_units);
  const coverageDays = avgDailyUsage > 0 ? (totalAvail / avgDailyUsage).toFixed(1) : '—';
  const worstRisk = lowBuckets.some((b) => b.available_units <= 1)
    ? 'Critical'
    : lowBuckets.length > 3
      ? 'High'
      : lowBuckets.length > 0
        ? 'Medium'
        : 'Low';

  return (
    <AppShell
      title="Hospital Transfusion & Supply Desk"
      subtitle="Live unit stock, FEFO consumption, emergency requests & AI demand coverage"
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-600">Hospital:</label>
          <select
            value={selectedOrgId}
            disabled={user?.role === 'hospital_staff'}
            onChange={(e) => setSelectedOrgId(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium disabled:bg-slate-100"
          >
            {hospitals.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} ({h.code})
              </option>
            ))}
          </select>
        </div>

        {feedback && (
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-800">
            {feedback}
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Available Usable Units"
          value={totalAvail}
          sublabel={`${lowBuckets.length} buckets below safety stock`}
          icon={<Droplets className="h-5 w-5 text-red-600" />}
        />
        <StatCard
          label="Estimated Stock Coverage"
          value={`${coverageDays} days`}
          sublabel={`Avg ${avgDailyUsage.toFixed(1)} units/day`}
          icon={<Clock className="h-5 w-5" />}
        />
        <StatCard
          label="Hospital Risk Indicator"
          value={worstRisk}
          sublabel="Based on safety stock & demand"
          icon={<AlertTriangle className="h-5 w-5 text-amber-600" />}
          tone={worstRisk === 'Critical' ? 'danger' : worstRisk === 'High' ? 'warning' : 'success'}
        />
        <StatCard
          label="Expiring Within 7d"
          value={expiring.length}
          sublabel="Use FEFO order first"
          icon={<PackagePlus className="h-5 w-5" />}
        />
      </div>

      {/* Action Forms + Forecast */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-900">Record Consumption (FEFO)</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Automatically consumes oldest valid units first. Zero patient PII accepted.
          </p>
          <form onSubmit={handleRecordConsumption} className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <select
                value={consForm.blood_group}
                onChange={(e) => setConsForm({ ...consForm, blood_group: e.target.value })}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
              >
                {BLOOD_GROUPS.map((bg) => (
                  <option key={bg} value={bg}>
                    {bg}
                  </option>
                ))}
              </select>
              <select
                value={consForm.component}
                onChange={(e) => setConsForm({ ...consForm, component: e.target.value })}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
              >
                {BLOOD_COMPONENTS.map((c) => (
                  <option key={c} value={c}>
                    {COMPONENT_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={50}
                value={consForm.units_used}
                onChange={(e) => setConsForm({ ...consForm, units_used: e.target.value })}
                className="w-24 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
              />
              <label className="flex items-center gap-1.5 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={consForm.emergency_flag}
                  onChange={(e) => setConsForm({ ...consForm, emergency_flag: e.target.checked })}
                />
                Emergency Case
              </label>
            </div>
            <input
              placeholder="Clinical ward/case note (no patient PII)"
              value={consForm.notes}
              onChange={(e) => setConsForm({ ...consForm, notes: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
            />
            <Button type="submit" size="sm" className="w-full">
              Record Transfusion Usage
            </Button>
          </form>

          <hr className="my-5 border-slate-100" />

          <h3 className="text-sm font-semibold text-slate-900">Request Blood / Emergency</h3>
          <form onSubmit={handleCreateRequest} className="mt-3 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <select
                value={reqForm.blood_group}
                onChange={(e) => setReqForm({ ...reqForm, blood_group: e.target.value })}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              >
                {BLOOD_GROUPS.map((bg) => (
                  <option key={bg} value={bg}>
                    {bg}
                  </option>
                ))}
              </select>
              <select
                value={reqForm.component}
                onChange={(e) => setReqForm({ ...reqForm, component: e.target.value })}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              >
                {BLOOD_COMPONENTS.map((c) => (
                  <option key={c} value={c}>
                    {c.toUpperCase()}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={100}
                value={reqForm.units_requested}
                onChange={(e) => setReqForm({ ...reqForm, units_requested: e.target.value })}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              />
            </div>
            <select
              value={reqForm.urgency}
              onChange={(e) => setReqForm({ ...reqForm, urgency: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
            >
              <option value="routine">Routine Replenishment</option>
              <option value="urgent">Urgent (&lt; 6 hours)</option>
              <option value="emergency">Emergency (&lt; 2 hours)</option>
            </select>
            <Button type="submit" variant="secondary" size="sm" className="w-full">
              Submit Supply Request
            </Button>
          </form>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title={`${horizon}-Day Demand Forecast`}
            subtitle="Daily demand projection with 95% confidence bounds"
            right={
              <div className="flex items-center gap-2">
                <DataSourceBadge kind="PREDICTED" />
                <button
                  onClick={() => setHorizon(7)}
                  className={`rounded px-2 py-1 text-xs font-semibold ${
                    horizon === 7 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  7D
                </button>
                <button
                  onClick={() => setHorizon(30)}
                  className={`rounded px-2 py-1 text-xs font-semibold ${
                    horizon === 30 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  30D
                </button>
              </div>
            }
          />
          <div className="h-80 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={forecast}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="target_date" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="upper_bound"
                  name="Upper CI"
                  stroke="none"
                  fill="#c7d2fe"
                  fillOpacity={0.5}
                />
                <Area
                  type="monotone"
                  dataKey="predicted_demand"
                  name="Predicted Units"
                  stroke="#4f46e5"
                  fill="#818cf8"
                  fillOpacity={0.25}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Current Stock Matrix + Requests/Transfers */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Current Stock vs Safety Levels"
            right={<DataSourceBadge kind="ACTUAL" />}
          />
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase sticky top-0">
                <tr>
                  <th className="px-4 py-2.5">Group / Component</th>
                  <th className="px-4 py-2.5">Available</th>
                  <th className="px-4 py-2.5">Safety</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {inventory.map((row) => {
                  const risk =
                    row.available_units === 0
                      ? 'Critical'
                      : row.available_units < row.safety_stock_units * 0.5
                        ? 'High'
                        : row.available_units < row.safety_stock_units
                          ? 'Medium'
                          : 'Low';
                  return (
                    <tr key={`${row.blood_group}-${row.component}`}>
                      <td className="px-4 py-2 font-semibold">
                        {row.blood_group} • {row.component}
                      </td>
                      <td className="px-4 py-2 font-bold">{row.available_units}</td>
                      <td className="px-4 py-2 text-slate-500">{row.safety_stock_units}</td>
                      <td className="px-4 py-2">
                        <RiskBadge risk={risk} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Requests, Matches & Incoming Transfers" />
          <div className="max-h-80 space-y-3 overflow-y-auto p-4 text-xs">
            {requests.map((r) => (
              <div key={r.id} className="rounded-lg border border-slate-200 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">
                    {r.request_code} • {r.units_requested}x {r.blood_group} ({r.component})
                  </span>
                  <Badge variant={r.urgency === 'emergency' ? 'danger' : 'warning'}>
                    {r.urgency} • {r.status}
                  </Badge>
                </div>
                {r.status !== 'fulfilled' && (
                  <Button size="sm" variant="secondary" onClick={() => loadMatches(r.id)}>
                    Find Nearby Blood Banks
                  </Button>
                )}
                {matches?.requestId === r.id && (
                  <div className="mt-2 space-y-1.5 rounded bg-slate-50 p-2">
                    {matches.rows.slice(0, 3).map((m) => (
                      <div
                        key={`${m.source_org_id}-${m.blood_group}`}
                        className="flex items-center justify-between gap-2"
                      >
                        <span>
                          {m.name} ({m.blood_group}, {m.available_units} avail, {m.distance_km} km)
                        </span>
                        <Button size="sm" onClick={() => proposeTransfer(m, r)}>
                          Request Transfer
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {transfers.map((tr) => (
              <div
                key={tr.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3"
              >
                <div>
                  <div className="flex items-center gap-1.5 font-semibold">
                    <Truck className="h-3.5 w-3.5 text-slate-600" />
                    {tr.transfer_code} from {tr.source_org_name}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {tr.units_count}x {tr.blood_group} ({tr.component}) • {tr.distance_km} km
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={tr.approval_status === 'completed' ? 'success' : 'info'}>
                    {tr.approval_status}
                  </Badge>
                  {tr.approval_status === 'in_transit' && (
                    <Button size="sm" onClick={() => confirmReceipt(tr.id)}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Receive
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
