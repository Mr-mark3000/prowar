'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertOctagon,
  Clock,
  Layers,
  PlusCircle,
  ShieldCheck,
  Warehouse,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataSourceBadge,
  StatCard,
} from '@/components/ui';
import { apiFetch, BLOOD_COMPONENTS, BLOOD_GROUPS, COMPONENT_LABELS } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

interface OrgOption {
  id: string;
  code: string;
  name: string;
}

interface BloodUnitRow {
  id: string;
  unit_code: string;
  blood_group: string;
  component: string;
  collection_date: string;
  expiry_date: string;
  days_until_expiry: number;
  status: string;
  cold_chain_ok: boolean;
}

interface TransferRow {
  id: string;
  transfer_code: string;
  target_org_name: string;
  blood_group: string;
  component: string;
  units_count: number;
  approval_status: string;
  recommended_by_ai: boolean;
  distance_km: number;
  eta_minutes: number;
}

interface InventoryRow {
  blood_group: string;
  component: string;
  available_units: number;
  safety_stock_units: number;
}

export default function BloodBankDashboard() {
  const { user } = useAuth();
  const [bloodBanks, setBloodBanks] = useState<OrgOption[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [units, setUnits] = useState<BloodUnitRow[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const [regForm, setRegForm] = useState({
    blood_group: 'O-',
    component: 'whole_blood',
    collection_date: new Date().toISOString().slice(0, 10),
    quantity: '2',
    cold_chain_ok: true,
  });

  useEffect(() => {
    apiFetch<{ organizations: OrgOption[] }>('/api/organizations?type=blood_bank')
      .then((res) => {
        setBloodBanks(res.organizations);
        if (user?.organization_id && user.role === 'blood_bank_staff') {
          setSelectedOrgId(user.organization_id);
        } else if (res.organizations.length > 0) {
          const rc = res.organizations.find((o) => o.code === 'BB-REDCROSS');
          setSelectedOrgId(rc ? rc.id : res.organizations[0].id);
        }
      })
      .catch(() => {});
  }, [user]);

  const loadData = useCallback(async () => {
    if (!selectedOrgId) return;
    try {
      const [unitsRes, invRes, trRes] = await Promise.all([
        apiFetch<{ units: BloodUnitRow[] }>(
          `/api/inventory/units?organization_id=${selectedOrgId}&limit=80`
        ),
        apiFetch<{ inventory: InventoryRow[] }>(`/api/inventory?organization_id=${selectedOrgId}`),
        apiFetch<{ transfers: TransferRow[] }>(`/api/transfers?org_id=${selectedOrgId}`),
      ]);
      setUnits(unitsRes.units);
      setInventory(invRes.inventory);
      setTransfers(trRes.transfers);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed to load blood bank data');
    }
  }, [selectedOrgId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRegisterUnits = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      const res = await apiFetch<{ units: BloodUnitRow[] }>('/api/inventory/units', {
        method: 'POST',
        body: JSON.stringify({
          organization_id: selectedOrgId,
          blood_group: regForm.blood_group,
          component: regForm.component,
          collection_date: regForm.collection_date,
          quantity: Number(regForm.quantity),
          cold_chain_ok: regForm.cold_chain_ok,
        }),
      });
      setMsg(`Registered ${res.units.length} individual unit(s).`);
      loadData();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Registration failed');
    }
  };

  const handleSeparate = async (unitId: string) => {
    try {
      const res = await apiFetch<{ derived_units: BloodUnitRow[] }>(
        `/api/inventory/units/${unitId}/separate`,
        {
          method: 'POST',
          body: JSON.stringify({ components: ['rbc', 'platelets', 'plasma'] }),
        }
      );
      setMsg(`Separated into ${res.derived_units.length} components (RBC, Platelets, Plasma).`);
      loadData();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Separation failed');
    }
  };

  const handleQuarantine = async (unitId: string) => {
    await apiFetch(`/api/inventory/units/${unitId}/quarantine`, {
      method: 'PATCH',
      body: JSON.stringify({
        action: 'quarantine',
        reason: 'Flagged by blood bank QA cold-chain inspection',
      }),
    });
    setMsg('Unit quarantined. Safety policy prevents auto-restoring to usable stock.');
    loadData();
  };

  const handleTransfer = async (id: string, action: 'approve' | 'reject' | 'dispatch') => {
    const body =
      action === 'reject'
        ? JSON.stringify({ rejection_reason: 'Declined by blood bank release officer' })
        : undefined;
    await apiFetch(`/api/transfers/${id}/${action}`, { method: 'POST', body });
    setMsg(`Transfer ${action} successful.`);
    loadData();
  };

  const availableCount = inventory.reduce((s, r) => s + r.available_units, 0);
  const surplusBuckets = inventory.filter((r) => r.available_units > r.safety_stock_units + 5);
  const expiringSoon = units.filter(
    (u) => u.status === 'available' && u.days_until_expiry <= 7
  );
  const pendingApprovals = transfers.filter((t) => t.approval_status === 'pending');

  return (
    <AppShell
      title="Blood Bank Operations Center"
      subtitle="Unit registration, component separation, FEFO expiry & human transfer sign-off"
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-600">Blood Bank:</label>
          <select
            value={selectedOrgId}
            disabled={user?.role === 'blood_bank_staff'}
            onChange={(e) => setSelectedOrgId(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium disabled:bg-slate-100"
          >
            {bloodBanks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>
        </div>

        {msg && (
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-800">
            {msg}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Available Units"
          value={availableCount}
          sublabel="Cold-chain verified stock"
          icon={<Warehouse className="h-5 w-5" />}
          tone="success"
        />
        <StatCard
          label="Pending Approvals"
          value={pendingApprovals.length}
          sublabel="Requires authorized staff sign-off"
          icon={<ShieldCheck className="h-5 w-5 text-amber-600" />}
          tone={pendingApprovals.length > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Expiring Within 7d"
          value={expiringSoon.length}
          sublabel="Prioritize FEFO dispatch"
          icon={<Clock className="h-5 w-5 text-red-600" />}
        />
        <StatCard
          label="Surplus Buckets"
          value={surplusBuckets.length}
          sublabel="Groups above safety + 5 buffer"
          icon={<Layers className="h-5 w-5" />}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Register Unit Form */}
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <PlusCircle className="h-4 w-4 text-red-600" />
            <h3 className="text-sm font-semibold text-slate-900">Register Individual Units</h3>
          </div>
          <form onSubmit={handleRegisterUnits} className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <select
                value={regForm.blood_group}
                onChange={(e) => setRegForm({ ...regForm, blood_group: e.target.value })}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
              >
                {BLOOD_GROUPS.map((bg) => (
                  <option key={bg} value={bg}>
                    {bg}
                  </option>
                ))}
              </select>
              <select
                value={regForm.component}
                onChange={(e) => setRegForm({ ...regForm, component: e.target.value })}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
              >
                {BLOOD_COMPONENTS.map((c) => (
                  <option key={c} value={c}>
                    {COMPONENT_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={regForm.collection_date}
                onChange={(e) => setRegForm({ ...regForm, collection_date: e.target.value })}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
              />
              <input
                type="number"
                min={1}
                max={20}
                value={regForm.quantity}
                onChange={(e) => setRegForm({ ...regForm, quantity: e.target.value })}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={regForm.cold_chain_ok}
                onChange={(e) => setRegForm({ ...regForm, cold_chain_ok: e.target.checked })}
              />
              Cold-chain integrity verified
            </label>
            <Button type="submit" size="sm" className="w-full">
              Register Units
            </Button>
          </form>

          <hr className="my-5 border-slate-100" />
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Surplus Allocation Candidates
          </h4>
          <div className="mt-2 space-y-1.5 text-xs">
            {surplusBuckets.slice(0, 5).map((s) => (
              <div
                key={`${s.blood_group}-${s.component}`}
                className="flex items-center justify-between rounded bg-emerald-50 px-2.5 py-1.5 text-emerald-800"
              >
                <span className="font-semibold">
                  {s.blood_group} ({s.component})
                </span>
                <span>+{s.available_units - s.safety_stock_units} surplus</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Transfer Requests Approval Queue */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Transfer Requests & Human Approval Queue"
            subtitle="Clinical staff must review compatibility & approve before dispatch"
            right={<Badge variant="warning">Never Auto-Approved</Badge>}
          />
          <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
            {transfers.length === 0 ? (
              <p className="p-6 text-xs text-slate-400 text-center">No transfers for this blood bank.</p>
            ) : (
              transfers.map((tr) => (
                <div key={tr.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-xs">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-slate-900">
                      {tr.transfer_code} → {tr.target_org_name}
                      {tr.recommended_by_ai && <Badge variant="purple">AI Ranked</Badge>}
                    </div>
                    <div className="mt-0.5 text-slate-500">
                      {tr.units_count}x {tr.blood_group} ({tr.component}) • {tr.distance_km} km (~
                      {tr.eta_minutes} min)
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        tr.approval_status === 'pending'
                          ? 'warning'
                          : tr.approval_status === 'approved'
                            ? 'info'
                            : tr.approval_status === 'completed'
                              ? 'success'
                              : 'neutral'
                      }
                    >
                      {tr.approval_status}
                    </Badge>
                    {tr.approval_status === 'pending' && (
                      <>
                        <Button size="sm" onClick={() => handleTransfer(tr.id, 'approve')}>
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleTransfer(tr.id, 'reject')}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {tr.approval_status === 'approved' && (
                      <Button size="sm" onClick={() => handleTransfer(tr.id, 'dispatch')}>
                        Dispatch
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Unit-level Inventory + Component Separation + Expiry */}
      <Card className="mt-6">
        <CardHeader
          title="Unit-Level Inventory & Component Separation (FEFO Order)"
          subtitle="Split Whole Blood into RBC/Platelets/Plasma or quarantine cold-chain excursions"
          right={<DataSourceBadge kind="ACTUAL" />}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Unit Code</th>
                <th className="px-4 py-3">Group / Component</th>
                <th className="px-4 py-3">Expiry Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {units.slice(0, 25).map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono font-semibold text-slate-800">
                    {u.unit_code}
                  </td>
                  <td className="px-4 py-2.5">
                    {u.blood_group} • {u.component}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={
                        u.days_until_expiry <= 3
                          ? 'font-semibold text-red-600'
                          : 'text-slate-600'
                      }
                    >
                      {u.expiry_date.slice(0, 10)} ({u.days_until_expiry}d left)
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge
                      variant={
                        u.status === 'available'
                          ? 'success'
                          : u.status === 'quarantined'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {u.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1.5">
                      {u.component === 'whole_blood' && u.status === 'available' && (
                        <Button size="sm" variant="secondary" onClick={() => handleSeparate(u.id)}>
                          Separate Components
                        </Button>
                      )}
                      {u.status === 'available' && (
                        <Button size="sm" variant="ghost" onClick={() => handleQuarantine(u.id)}>
                          <AlertOctagon className="h-3.5 w-3.5 text-rose-600" /> Quarantine
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
    </AppShell>
  );
}
