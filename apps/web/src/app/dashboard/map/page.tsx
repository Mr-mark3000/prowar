'use client';

import React from 'react';
import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Card } from '@/components/ui';

export default function MapPlaceholderPage() {
  return (
    <AppShell
      title="Ranchi Geo-Intelligence Map"
      subtitle="Interactive Leaflet + OpenStreetMap spatial command center (Phase 5)"
    >
      <Card className="p-8 text-center max-w-2xl mx-auto mt-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-600">
          <MapPin className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-900">
          Geo-Intelligence Map Coming in Phase 5
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          In Phase 5, this view will render all 10 Ranchi hospitals and 5 blood banks on
          OpenStreetMap with Live Availability, Shortage Risk Heatmap, OR-Tools Supply &amp; Demand
          Flow arrows, Expiry Risk, Emergency Response, and What-If Simulation layers.
        </p>
        <div className="mt-5">
          <Link
            href="/dashboard/analytics"
            className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            View Predictive Analytics
          </Link>
        </div>
      </Card>
    </AppShell>
  );
}
