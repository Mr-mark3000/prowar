import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  BLOOD_GROUPS,
  COMPONENTS,
  RANCHI_ORGANIZATIONS,
  generateBloodUnits,
  generateHistoricalConsumption,
  hashPassword,
} from './synthetic-data.mjs';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');

function loadEnv() {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

async function seed() {
  loadEnv();
  const databaseUrl =
    process.env.DATABASE_URL ||
    'postgresql://bloodnet:bloodnet_dev_password@localhost:5432/bloodnet_ai';

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    console.log('Starting BloodNet AI seed for Ranchi pilot...');
    await client.query('BEGIN');

    // Clear existing operational data (idempotent re-seed)
    await client.query(`
      TRUNCATE TABLE
        audit_log,
        inventory_transactions,
        notifications,
        shortage_alerts,
        predictions,
        transfer_units,
        transfers,
        consumption,
        blood_inventory,
        blood_units,
        blood_requests,
        users,
        organizations
      RESTART IDENTITY CASCADE;
    `);

    // 1. Insert 10 Hospitals + 5 Blood Banks
    const orgRows = [];
    for (const org of RANCHI_ORGANIZATIONS) {
      const { rows } = await client.query(
        `
        INSERT INTO organizations (
          code, name, type, district, address, lat, lng,
          contact_phone, contact_email, storage_capacity_units, safety_stock_days
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id, code, name, type, lat, lng, safety_stock_days
        `,
        [
          org.code,
          org.name,
          org.type,
          org.district,
          org.address,
          org.lat,
          org.lng,
          org.contact_phone,
          org.contact_email,
          org.storage_capacity_units,
          org.safety_stock_days,
        ]
      );
      orgRows.push(rows[0]);
    }
    const orgByCode = new Map(orgRows.map((o) => [o.code, o]));
    console.log(`Seeded ${orgRows.length} organizations (10 hospitals, 5 blood banks).`);

    // 2. Seed RBAC Demo Users (zero PII)
    const defaultPassHash = hashPassword('BloodNet@2026');
    const usersInput = [
      {
        email: 'admin@bloodnet.jh.gov.pilot',
        full_name: 'Ranchi Regional Command Admin',
        role: 'central_admin',
        org_code: null,
      },
      {
        email: 'authority@jhsacs.pilot',
        full_name: 'Jharkhand State Blood Authority Officer',
        role: 'regional_authority',
        org_code: null,
      },
      {
        email: 'staff@rajhospital.pilot',
        full_name: 'Raj Hospital Transfusion Coordinator',
        role: 'hospital_staff',
        org_code: 'HOSP-RAJ',
      },
      {
        email: 'staff@rimshospital.pilot',
        full_name: 'RIMS Hospital Blood Desk Lead',
        role: 'hospital_staff',
        org_code: 'HOSP-RIMS',
      },
      {
        email: 'staff@sadarhospital.pilot',
        full_name: 'Sadar Hospital Duty Officer',
        role: 'hospital_staff',
        org_code: 'HOSP-SADAR',
      },
      {
        email: 'bb@redcrossranchi.pilot',
        full_name: 'Red Cross Ranchi Blood Bank Officer',
        role: 'blood_bank_staff',
        org_code: 'BB-REDCROSS',
      },
      {
        email: 'bb@rimsbloodbank.pilot',
        full_name: 'RIMS Blood Bank Medical Officer',
        role: 'blood_bank_staff',
        org_code: 'BB-RIMS',
      },
      {
        email: 'bb@lifesavers.pilot',
        full_name: 'Life Savers Blood Bank Supervisor',
        role: 'blood_bank_staff',
        org_code: 'BB-LIFESAVERS',
      },
    ];

    const userRows = [];
    for (const u of usersInput) {
      const orgId = u.org_code ? orgByCode.get(u.org_code)?.id || null : null;
      const { rows } = await client.query(
        `
        INSERT INTO users (email, password_hash, full_name, role, organization_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, email, role, organization_id
        `,
        [u.email, defaultPassHash, u.full_name, u.role, orgId]
      );
      userRows.push(rows[0]);
    }
    const adminUser = userRows[0];
    const rajUser = userRows.find((u) => u.email === 'staff@rajhospital.pilot');
    const redcrossUser = userRows.find((u) => u.email === 'bb@redcrossranchi.pilot');
    console.log(`Seeded ${userRows.length} RBAC users.`);

    // 3. Seed 18 months (540 days) of synthetic historical consumption using UNNEST bulk insert
    const consumptionRecords = generateHistoricalConsumption(orgRows, new Date(), 540);
    const chunkSize = 10000;
    for (let i = 0; i < consumptionRecords.length; i += chunkSize) {
      const chunk = consumptionRecords.slice(i, i + chunkSize);
      await client.query(
        `
        INSERT INTO consumption (
          organization_id, blood_group, component, consumption_date,
          units_used, emergency_units, emergency_flag, source
        )
        SELECT * FROM UNNEST (
          $1::uuid[], $2::varchar[], $3::varchar[], $4::date[],
          $5::int[], $6::int[], $7::boolean[], $8::varchar[]
        )
        `,
        [
          chunk.map((r) => r.organization_id),
          chunk.map((r) => r.blood_group),
          chunk.map((r) => r.component),
          chunk.map((r) => r.consumption_date),
          chunk.map((r) => r.units_used),
          chunk.map((r) => r.emergency_units),
          chunk.map((r) => r.emergency_flag),
          chunk.map((r) => r.source),
        ]
      );
    }
    console.log(`Seeded ${consumptionRecords.length} daily consumption records (18 months).`);

    // 4. Seed individual Blood Units (trigger keeps blood_inventory synchronized)
    const unitRecords = generateBloodUnits(orgRows, new Date());
    const unitChunkSize = 1000;
    for (let i = 0; i < unitRecords.length; i += unitChunkSize) {
      const chunk = unitRecords.slice(i, i + unitChunkSize);
      await client.query(
        `
        INSERT INTO blood_units (
          unit_code, organization_id, blood_group, component, volume_ml,
          collection_date, expiry_date, status, is_reserved, cold_chain_ok, cold_chain_notes
        )
        SELECT * FROM UNNEST (
          $1::varchar[], $2::uuid[], $3::varchar[], $4::varchar[], $5::int[],
          $6::date[], $7::date[], $8::varchar[], $9::boolean[], $10::boolean[], $11::text[]
        )
        `,
        [
          chunk.map((u) => u.unit_code),
          chunk.map((u) => u.organization_id),
          chunk.map((u) => u.blood_group),
          chunk.map((u) => u.component),
          chunk.map((u) => u.volume_ml),
          chunk.map((u) => u.collection_date),
          chunk.map((u) => u.expiry_date),
          chunk.map((u) => u.status),
          chunk.map((u) => u.is_reserved),
          chunk.map((u) => u.cold_chain_ok),
          chunk.map((u) => u.cold_chain_notes),
        ]
      );
    }
    console.log(`Seeded ${unitRecords.length} individual blood units.`);

    // 5. Ensure all 15 * 8 * 4 = 480 inventory buckets exist & calibrate safety_stock_units
    for (const org of orgRows) {
      const baseDemand =
        RANCHI_ORGANIZATIONS.find((o) => o.code === org.code)?.dailyBaseDemand || 20;
      for (const bg of BLOOD_GROUPS) {
        for (const comp of Object.keys(COMPONENTS)) {
          const safety = Math.max(
            2,
            Math.round(baseDemand * (org.safety_stock_days || 5) * 0.08)
          );
          await client.query(
            `
            INSERT INTO blood_inventory (
              organization_id, blood_group, component, safety_stock_units
            )
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (organization_id, blood_group, component)
            DO UPDATE SET safety_stock_units = EXCLUDED.safety_stock_units
            `,
            [org.id, bg, comp, safety]
          );
        }
      }
    }

    // 6. Seed starter blood request + pending AI-recommended transfer (human approval required)
    const rajOrg = orgByCode.get('HOSP-RAJ');
    const redCrossOrg = orgByCode.get('BB-REDCROSS');
    const rimsBBOrg = orgByCode.get('BB-RIMS');

    const reqRes = await client.query(
      `
      INSERT INTO blood_requests (
        request_code, requesting_org_id, blood_group, component,
        units_requested, urgency, status, required_by, notes, created_by
      )
      VALUES (
        'REQ-RNC-2026-001', $1, 'O-', 'rbc',
        4, 'urgent', 'open', NOW() + INTERVAL '6 hours',
        'Projected O- RBC shortfall for emergency surgical roster', $2
      )
      RETURNING id
      `,
      [rajOrg.id, rajUser.id]
    );
    const requestId = reqRes.rows[0].id;

    // Pick 4 FEFO available O- RBC units from Red Cross Ranchi and reserve them for pending transfer
    const fefoUnits = await client.query(
      `
      SELECT id FROM blood_units
      WHERE organization_id = $1
        AND blood_group = 'O-'
        AND component = 'rbc'
        AND status = 'available'
        AND is_reserved = FALSE
        AND cold_chain_ok = TRUE
      ORDER BY expiry_date ASC
      LIMIT 4
      FOR UPDATE
      `,
      [redCrossOrg.id]
    );

    if (fefoUnits.rows.length > 0) {
      const trRes = await client.query(
        `
        INSERT INTO transfers (
          transfer_code, source_org_id, target_org_id, request_id,
          blood_group, component, units_count, approval_status,
          recommended_by_ai, ai_priority_rank, ai_objective_score, ai_rationale,
          distance_km, eta_minutes, created_by
        )
        VALUES (
          'TRF-RNC-2026-001', $1, $2, $3,
          'O-', 'rbc', $4, 'pending',
          TRUE, 1, 0.184,
          '{"reason":"Shortest cold-chain transit with surplus O- RBC above 7-day safety stock","fefo_applied":true}'::jsonb,
          1.15, 7, $5
        )
        RETURNING id
        `,
        [redCrossOrg.id, rajOrg.id, requestId, fefoUnits.rows.length, adminUser.id]
      );
      const transferId = trRes.rows[0].id;

      for (const u of fefoUnits.rows) {
        await client.query(
          `INSERT INTO transfer_units (transfer_id, unit_id, is_active) VALUES ($1, $2, TRUE)`,
          [transferId, u.id]
        );
        await client.query(
          `UPDATE blood_units SET status = 'reserved', is_reserved = TRUE, reserved_for_request_id = $1 WHERE id = $2`,
          [requestId, u.id]
        );
        await client.query(
          `
          INSERT INTO inventory_transactions (
            unit_id, organization_id, transaction_type, delta_units,
            previous_status, new_status, performed_by, reference_id, notes
          )
          VALUES ($1, $2, 'reserve', 0, 'available', 'reserved', $3, $4, 'Reserved for AI-recommended pending transfer TRF-RNC-2026-001')
          `,
          [u.id, redCrossOrg.id, redcrossUser.id, transferId]
        );
      }
    }

    // 7. Seed initial Shortage Alert, Notification, and Audit Log entry
    await client.query(
      `
      INSERT INTO shortage_alerts (
        organization_id, blood_group, component, risk_level,
        current_stock, safety_stock, projected_stock_7d, projected_stock_30d,
        expected_shortage_date, confidence_lower, confidence_upper,
        explanation, drivers, status
      )
      VALUES (
        $1, 'O-', 'rbc', 'Critical',
        1, 6, -3.2, -14.5,
        CURRENT_DATE + INTERVAL '1 day', -5.0, -1.5,
        'O- RBC risk is Critical at Raj Hospital: current usable stock (1 unit) is 83% below safety stock (6 units) with elevated trauma demand.',
        '{"stock_ratio":0.17,"recent_trend_pct":24,"nearby_surplus_org":"BB-REDCROSS"}'::jsonb,
        'active'
      )
      `,
      [rajOrg.id]
    );

    await client.query(
      `
      INSERT INTO notifications (
        organization_id, target_role, title, message, severity, category, metadata
      )
      VALUES (
        $1, 'blood_bank_staff',
        'AI Transfer Recommendation Pending Approval',
        'Transfer TRF-RNC-2026-001 recommends dispatching 4 O- RBC units from Red Cross Ranchi to Raj Hospital (1.15 km, ~7 min). Human approval required.',
        'high', 'transfer',
        '{"transfer_code":"TRF-RNC-2026-001","requires_human_approval":true}'::jsonb
      )
      `,
      [redCrossOrg.id]
    );

    await client.query(
      `
      INSERT INTO audit_log (
        actor_user_id, actor_role, organization_id, action, entity_type, entity_id, new_values
      )
      VALUES (
        $1, 'central_admin', $2, 'SEED_DATABASE', 'system', 'ranchi-pilot-v1',
        $3::jsonb
      )
      `,
      [
        adminUser.id,
        rimsBBOrg.id,
        JSON.stringify({
          organizations: orgRows.length,
          units: unitRecords.length,
          consumption_rows: consumptionRecords.length,
          run_id: crypto.randomUUID(),
        }),
      ]
    );

    await client.query('COMMIT');
    console.log('Seed completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
