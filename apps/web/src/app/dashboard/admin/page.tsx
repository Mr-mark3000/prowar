'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Building2,
  CheckCircle2,
  Clock,
  MapPin,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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
import { apiFetch } from '@/lib/api';

interface OrgRow {
  id: string;
  code: string;
  name: string;
  type: 'hospital' | 'blood_bank' | 'collection_center';
  district: string;
  lat: number;
  lng: number;
  total_available_units: number;
  total_reserved_units: number;
  expiring_within_7d_units: number;
  quarantined_units: number;
  active_alerts_count: number;
}

interface InventoryByGroupRow {
  blood_group: string;
  available_units: number;
  reserved_units: number;
  expiring_7d: number;
  safety_stock_units: number;
}

interface AlertRow {
  id: string;
  organization_name: string;
  blood_group: string;
  component: string;
  risk_level: string;
  current_stock: number;
  safety_stock: number;
  explanation: string;
  status: string;
  expected_shortage_date: string | null;
}

interface TransferRow {
  id: string;
  transfer_code: string;
  source_org_name: string;
  target_org_name: string;
  blood_group: string;
  component: string;
  units_count: number;
  approval_status: string;
  recommended_by_ai: boolean;
  distance_km: number;
  eta_minutes: number;
}

interface AuditRow {
  id: string;
  actor_email: string | null;
  actor_role: string | null;
  organization_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
}

export default function CentralAdminDashboard() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [groupBars, setGroupBars] = useState<InventoryByGroupRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);
  const [tab, setTab] = useState<'overview' | 'orgs' | 'allocations' | 'audit'>('overview');
  const [msg, setMsg] = useState<string | null>(null);

  // New organization form state
  const [showNewOrg, setShowNewOrg] = useState(false);
  const [newOrg, setNewOrg] = useState({
    code: '',
    name: '',
    type: 'hospital',
    address: '',
    lat: '23.37',
    lng: '85.33',
    safety_stock_days: '5',
  });

  const loadData = useCallback(async () => {
    try {
      const [orgsRes, analyticsRes, alertsRes, transfersRes, auditRes] = await Promise.all([
        apiFetch<{ organizations: OrgRow[] }>('/api/organizations'),
        apiFetch<{ inventory_by_group: InventoryByGroupRow[] }>('/api/analytics/overview'),
        apiFetch<{ alerts: AlertRow[] }>('/api/alerts'),
        apiFetch<{ transfers: TransferRow[] }>('/api/transfers'),
        apiFetch<{ audit_logs: AuditRow[] }>('/api/audit-logs?limit=40'),
      ]);
      setOrgs(orgsRes.organizations);
      setGroupBars(analyticsRes.inventory_by_group);
      setAlerts(alertsRes.alerts);
      setTransfers(transfersRes.transfers);
      setAuditLogs(auditRes.audit_logs);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed to load dashboard');
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const acknowledgeAlert = async (id: string) => {
    await apiFetch(`/api/alerts/${id}/acknowledge`, { method: 'PATCH' });
    loadData();
  };

  const handleTransferAction = async (
    id: string,
    action: 'approve' | 'reject' | 'dispatch' | 'complete'
  ) => {
    const body =
      action === 'reject'
        ? JSON.stringify({ rejection_reason: 'Rejected by regional command review' })
        : undefined;
    await apiFetch(`/api/transfers/${id}/${action}`, { method: 'POST', body });
    setMsg(`Transfer updated (${action})`);
    loadData();
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/organizations', {
      method: 'POST',
      body: JSON.stringify({
        code: newOrg.code,
        name: newOrg.name,
        type: newOrg.type,
        address: newOrg.address,
        lat: Number(newOrg.lat),
        lng: Number(newOrg.lng),
        safety_stock_days: Number(newOrg.safety_stock_days),
      }),
    });
    setShowNewOrg(false);
    setNewOrg({
      code: '',
      name: '',
      type: 'hospital',
      address: '',
      lat: '23.37',
      lng: '85.33',
      safety_stock_days: '5',
    });
    setMsg('Organization registered successfully');
    loadData();
  };

  const totalAvailable = orgs.reduce((s, o) => s + o.total_available_units, 0);
  const totalExpiring = orgs.reduce((s, o) => s + o.expiring_within_7d_units, 0);
  const activeAlerts = alerts.filter((a) => a.status === 'active');
  const pendingTransfers = transfers.filter((t) => t.approval_status === 'pending');

  return (
    <AppShell
      title="Central Command Dashboard"
      subtitle="Ranchi Pilot Network • 10 Hospitals & 5 Blood Banks"
    >
      {msg && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-xs text-sky-800">
          <span>{msg}</span>
          <button onClick={() => setMsg(null)} className="font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Network Usable Units"
          value={totalAvailable}
          sublabel={`${orgs.length} active facilities`}
          icon={<Activity className="h-5 w-5" />}
          tone="success"
        />
        <StatCard
          label="Active Shortage Alerts"
          value={activeAlerts.length}
          sublabel={`${activeAlerts.filter((a) => a.risk_level === 'Critical').length} Critical`}
          icon={<AlertTriangle className="h-5 w-5 text-red-600" />}
          tone={activeAlerts.length > 0 ? 'danger' : 'default'}
        />
        <StatCard
          label="Pending Human Approval"
          value={pendingTransfers.length}
          sublabel="Transfers awaiting clinical sign-off"
          icon={<ArrowRightLeft className="h-5 w-5 text-amber-600" />}
          tone={pendingTransfers.length > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Expiring Within 7 Days"
          value={totalExpiring}
          sublabel="FEFO prioritization active"
          icon={<Clock className="h-5 w-5" />}
        />
      </div>

      {/* Sub-navigation tabs */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'overview', label: 'Network Overview & Alerts' },
            { id: 'allocations', label: `Allocation Center (${transfers.length})` },
            { id: 'orgs', label: `Organizations (${orgs.length})` },
            { id: 'audit', label: 'Audit Log' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as typeof tab)}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                tab === t.id
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <Link
          href="/dashboard/map"
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
        >
          <MapPin className="h-3.5 w-3.5" />
          Open Ranchi Geo-Intelligence Map
        </Link>
      </div>

      {tab === 'overview' && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Blood-Group Inventory vs Safety Stock"
              subtitle="Live unreserved units across Ranchi network"
              right={<DataSourceBadge kind="ACTUAL" />}
            />
            <div className="h-80 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={groupBars}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="blood_group" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="available_units" name="Available Units" fill="#dc2626" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="reserved_units" name="Reserved" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="safety_stock_units" name="Safety Stock Target" fill="#334155" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Shortage Risk Alerts"
              subtitle="Explainable early-warning feed"
              right={<DataSourceBadge kind="PREDICTED" />}
            />
            <div className="max-h-80 space-y-3 overflow-y-auto p-4">
              {alerts.length === 0 ? (
                <p className="text-xs text-slate-400">No shortage alerts right now.</p>
              ) : (
                alerts.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-lg border border-slate-200 p-3 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">
                        {a.organization_name}
                      </span>
                      <RiskBadge risk={a.risk_level} />
                    </div>
                    <div className="font-medium text-slate-700">
                      {a.blood_group} ({a.component}) • Stock {a.current_stock} / Safety{' '}
                      {a.safety_stock}
                    </div>
                    <p className="text-[11px] text-slate-600">{a.explanation}</p>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] text-slate-400 uppercase">{a.status}</span>
                      {a.status === 'active' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => acknowledgeAlert(a.id)}
                        >
                          Acknowledge
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      {tab === 'allocations' && (
        <Card className="mt-6">
          <CardHeader
            title="Allocation & Transfer Approval Center"
            subtitle="AI recommends; authorized human staff always approve before dispatch"
            right={
              <Badge variant="warning">
                <ShieldCheck className="h-3 w-3" />
                Human-in-the-Loop Enforced
              </Badge>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Source → Target</th>
                  <th className="px-4 py-3">Blood / Qty</th>
                  <th className="px-4 py-3">Distance / ETA</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transfers.map((tr) => (
                  <tr key={tr.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-800">
                      {tr.transfer_code}
                      {tr.recommended_by_ai && (
                        <div className="mt-0.5">
                          <Badge variant="purple">AI Recommended</Badge>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{tr.source_org_name}</div>
                      <div className="text-slate-500">→ {tr.target_org_name}</div>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {tr.units_count}x {tr.blood_group} ({tr.component})
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {tr.distance_km} km • ~{tr.eta_minutes} min
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          tr.approval_status === 'completed'
                            ? 'success'
                            : tr.approval_status === 'pending'
                              ? 'warning'
                              : tr.approval_status === 'rejected'
                                ? 'danger'
                                : 'info'
                        }
                      >
                        {tr.approval_status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {tr.approval_status === 'pending' && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => handleTransferAction(tr.id, 'approve')}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleTransferAction(tr.id, 'reject')}
                            >
                              Reject
                            </Button>
                          </>
                        )}
                        {tr.approval_status === 'approved' && (
                          <Button
                            size="sm"
                            onClick={() => handleTransferAction(tr.id, 'dispatch')}
                          >
                            Dispatch
                          </Button>
                        )}
                        {tr.approval_status === 'in_transit' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleTransferAction(tr.id, 'complete')}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Confirm Receipt
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'orgs' && (
        <div className="mt-6 space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setShowNewOrg((v) => !v)}>
              <Plus className="h-3.5 w-3.5" /> Register Organization
            </Button>
          </div>

          {showNewOrg && (
            <Card className="p-4">
              <form onSubmit={handleCreateOrg} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <input
                  required
                  placeholder="Code (e.g. HOSP-NEW)"
                  value={newOrg.code}
                  onChange={(e) => setNewOrg({ ...newOrg, code: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                />
                <input
                  required
                  placeholder="Organization Name"
                  value={newOrg.name}
                  onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                />
                <select
                  value={newOrg.type}
                  onChange={(e) => setNewOrg({ ...newOrg, type: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                >
                  <option value="hospital">Hospital</option>
                  <option value="blood_bank">Blood Bank</option>
                  <option value="collection_center">Collection Center</option>
                </select>
                <input
                  required
                  placeholder="Address"
                  value={newOrg.address}
                  onChange={(e) => setNewOrg({ ...newOrg, address: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs sm:col-span-2"
                />
                <div className="flex gap-2">
                  <input
                    required
                    placeholder="Lat"
                    value={newOrg.lat}
                    onChange={(e) => setNewOrg({ ...newOrg, lat: e.target.value })}
                    className="w-1/2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  />
                  <input
                    required
                    placeholder="Lng"
                    value={newOrg.lng}
                    onChange={(e) => setNewOrg({ ...newOrg, lng: e.target.value })}
                    className="w-1/2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  />
                </div>
                <div className="sm:col-span-3 flex justify-end gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => setShowNewOrg(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm">
                    Save Organization
                  </Button>
                </div>
              </form>
            </Card>
          )}

          <Card>
            <CardHeader title="Registered Ranchi Facilities" />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase">
                  <tr>
                    <th className="px-4 py-3">Facility</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Available</th>
                    <th className="px-4 py-3">Reserved</th>
                    <th className="px-4 py-3">Expiring 7d</th>
                    <th className="px-4 py-3">Quarantined</th>
                    <th className="px-4 py-3">Alerts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orgs.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 font-semibold text-slate-900">
                          <Building2 className="h-3.5 w-3.5 text-slate-400" />
                          {o.name}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {o.code} • {o.lat.toFixed(4)}, {o.lng.toFixed(4)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={o.type === 'blood_bank' ? 'info' : 'neutral'}>
                          {o.type.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-semibold">{o.total_available_units}</td>
                      <td className="px-4 py-3">{o.total_reserved_units}</td>
                      <td className="px-4 py-3 text-amber-700">{o.expiring_within_7d_units}</td>
                      <td className="px-4 py-3 text-rose-700">{o.quarantined_units}</td>
                      <td className="px-4 py-3">
                        {o.active_alerts_count > 0 ? (
                          <Badge variant="danger">{o.active_alerts_count} active</Badge>
                        ) : (
                          <Badge variant="success">OK</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === 'audit' && (
        <Card className="mt-6">
          <CardHeader title="Immutable Audit Log" subtitle="Every inventory mutation, transfer, and login" />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Entity</th>
                  <th className="px-4 py-3">Organization</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-500">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-800">{log.actor_email || 'system'}</div>
                      <div className="text-[10px] text-slate-400">{log.actor_role}</div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] font-semibold text-slate-700">
                      {log.action}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {log.entity_type} {log.entity_id ? `(${log.entity_id.slice(0, 8)}...)` : ''}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{log.organization_name || 'Network'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </AppShell>
  );
}
