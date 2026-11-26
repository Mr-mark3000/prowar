'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, BarChart3, ShieldAlert } from 'lucide-react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AppShell } from '@/components/AppShell';
import { Badge, Card, CardHeader, DataSourceBadge } from '@/components/ui';
import { apiFetch, BLOOD_COMPONENTS, BLOOD_GROUPS, COMPONENT_LABELS } from '@/lib/api';

interface OrgOption {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface AnalyticsOverview {
  horizon_days: number;
  prediction_source: string;
  data_quality_warning: string | null;
  daily_actual: { date: string; actual_units: number; emergency_units: number }[];
  forecast_series: {
    target_date: string;
    predicted_demand: number;
    lower_bound: number;
    upper_bound: number;
    model_name: string;
  }[];
  inventory_projection: {
    date: string;
    projected_inventory: number;
    safety_stock: number;
    predicted_demand: number;
  }[];
  demand_by_group: { blood_group: string; units_30d: number; emergency_30d: number }[];
  seasonal_monthly: {
    month_label: string;
    rbc: number;
    platelets: number;
    plasma: number;
    whole_blood: number;
    total: number;
  }[];
  inventory_by_group: {
    blood_group: string;
    available_units: number;
    expiring_7d: number;
    quarantined_units: number;
    safety_stock_units: number;
  }[];
  alerts_summary: { blood_group: string; risk_level: string; cnt: number }[];
}

export default function PredictiveAnalyticsDashboard() {
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [orgId, setOrgId] = useState('all');
  const [bloodGroup, setBloodGroup] = useState('all');
  const [component, setComponent] = useState('all');
  const [horizon, setHorizon] = useState<7 | 30>(30);
  const [data, setData] = useState<AnalyticsOverview | null>(null);

  useEffect(() => {
    apiFetch<{ organizations: OrgOption[] }>('/api/organizations?type=hospital')
      .then((res) => setOrgs(res.organizations))
      .catch(() => {});
  }, []);

  const loadAnalytics = useCallback(async () => {
    const params = new URLSearchParams({
      organization_id: orgId,
      blood_group: bloodGroup,
      component,
      horizon: String(horizon),
    });
    const res = await apiFetch<AnalyticsOverview>(`/api/analytics/overview?${params.toString()}`);
    setData(res);
  }, [orgId, bloodGroup, component, horizon]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  // Combine last 30 actual days + forecast horizon on one continuous timeline
  const combinedTimeline = [
    ...(data?.daily_actual.slice(-30).map((d) => ({
      date: d.date,
      actual_units: d.actual_units,
      predicted_demand: null as number | null,
      lower_bound: null as number | null,
      upper_bound: null as number | null,
    })) || []),
    ...(data?.forecast_series.map((f) => ({
      date: f.target_date,
      actual_units: null as number | null,
      predicted_demand: f.predicted_demand,
      lower_bound: f.lower_bound,
      upper_bound: f.upper_bound,
    })) || []),
  ];

  return (
    <AppShell
      title="Predictive Demand & Risk Analytics"
      subtitle="Historical seasonal intelligence, ML forecast intervals & 30-day inventory simulation"
    >
      {/* Filters */}
      <Card className="mb-6 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500">
              Hospital / Scope
            </label>
            <select
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium"
            >
              <option value="all">All Ranchi Hospitals</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500">
              Blood Group
            </label>
            <select
              value={bloodGroup}
              onChange={(e) => setBloodGroup(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium"
            >
              <option value="all">All Blood Groups</option>
              {BLOOD_GROUPS.map((bg) => (
                <option key={bg} value={bg}>
                  {bg}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500">
              Component
            </label>
            <select
              value={component}
              onChange={(e) => setComponent(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium"
            >
              <option value="all">All Components</option>
              {BLOOD_COMPONENTS.map((c) => (
                <option key={c} value={c}>
                  {COMPONENT_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500">
              Forecast Horizon
            </label>
            <div className="mt-1 flex rounded-lg border border-slate-300 overflow-hidden">
              <button
                onClick={() => setHorizon(7)}
                className={`px-3 py-1.5 text-xs font-semibold ${
                  horizon === 7 ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'
                }`}
              >
                7 Days
              </button>
              <button
                onClick={() => setHorizon(30)}
                className={`px-3 py-1.5 text-xs font-semibold ${
                  horizon === 30 ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'
                }`}
              >
                30 Days
              </button>
            </div>
          </div>
        </div>

        {data?.data_quality_warning && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {data.data_quality_warning}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 1. Actual vs Predicted Demand */}
        <Card>
          <CardHeader
            title="Actual vs Predicted Daily Demand"
            subtitle="Last 30 actual days + forecast with 95% confidence band"
            right={
              <div className="flex gap-1.5">
                <DataSourceBadge kind="ACTUAL" />
                <DataSourceBadge kind="PREDICTED" />
              </div>
            }
          />
          <div className="h-80 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={combinedTimeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" fontSize={10} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="upper_bound"
                  name="Forecast Upper CI"
                  fill="#c7d2fe"
                  stroke="none"
                  fillOpacity={0.45}
                />
                <Line
                  type="monotone"
                  dataKey="actual_units"
                  name="Actual Demand"
                  stroke="#059669"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="predicted_demand"
                  name="Predicted Demand"
                  stroke="#4f46e5"
                  strokeDasharray="5 4"
                  strokeWidth={2.5}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 2. Projected Inventory Trajectory */}
        <Card>
          <CardHeader
            title={`${horizon}-Day Expected Inventory Trajectory`}
            subtitle="Simulated I(t+1) = I(t) - predicted demand - expected expiry"
            right={<DataSourceBadge kind="PREDICTED" />}
          />
          <div className="h-80 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.inventory_projection || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" fontSize={10} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="projected_inventory"
                  name="Projected Usable Stock"
                  stroke="#dc2626"
                  strokeWidth={2.5}
                  dot={false}
                />
                {data?.inventory_projection?.[0] && (
                  <ReferenceLine
                    y={data.inventory_projection[0].safety_stock}
                    stroke="#334155"
                    strokeDasharray="4 4"
                    label="Safety Stock"
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 3. Group-wise 30d Demand vs Emergency Spikes */}
        <Card>
          <CardHeader
            title="Blood Group Demand (Last 30 Days)"
            subtitle="Routine vs Emergency spike units"
            right={<DataSourceBadge kind="ACTUAL" />}
          />
          <div className="h-80 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.demand_by_group || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="blood_group" fontSize={12} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                <Bar dataKey="units_30d" name="Total 30d Consumption" fill="#0f172a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="emergency_30d" name="Emergency Units" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 4. Seasonal & Festival Component Comparison */}
        <Card>
          <CardHeader
            title="18-Month Seasonal & Component Trends"
            subtitle="Monsoon platelet surges (Aug–Nov) & festival trauma spikes"
            right={<DataSourceBadge kind="ACTUAL" />}
          />
          <div className="h-80 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.seasonal_monthly || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month_label" fontSize={10} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="rbc" name="RBC" stroke="#dc2626" strokeWidth={2} />
                <Line type="monotone" dataKey="platelets" name="Platelets" stroke="#f59e0b" strokeWidth={2} />
                <Line type="monotone" dataKey="plasma" name="Plasma" stroke="#2563eb" strokeWidth={2} />
                <Line type="monotone" dataKey="whole_blood" name="Whole Blood" stroke="#64748b" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Expiry / Quarantine & Active Shortage Risk Summary */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Expiry & Cold-Chain Wastage Risk by Group"
            subtitle="Units expiring within 7 days & quarantined units"
            right={<DataSourceBadge kind="ACTUAL" />}
          />
          <div className="h-64 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.inventory_by_group || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="blood_group" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                <Bar dataKey="expiring_7d" name="Expiring <= 7d" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="quarantined_units" name="Cold-Chain Quarantined" fill="#e11d48" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Active Shortage Alerts by Blood Group"
            subtitle="Current risk signals requiring review"
            right={<BarChart3 className="h-4 w-4 text-slate-400" />}
          />
          <div className="p-5 space-y-2.5">
            {!data || data.alerts_summary.length === 0 ? (
              <p className="text-xs text-slate-500">No active shortage alerts across the filtered scope.</p>
            ) : (
              data.alerts_summary.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-3.5 py-2.5 text-xs"
                >
                  <div className="flex items-center gap-2 font-semibold text-slate-800">
                    <ShieldAlert className="h-4 w-4 text-red-600" />
                    Blood Group {item.blood_group}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={item.risk_level === 'Critical' ? 'danger' : 'warning'}>
                      {item.risk_level}
                    </Badge>
                    <span className="text-slate-500">{item.cnt} facility alert(s)</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
