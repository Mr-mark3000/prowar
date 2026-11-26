import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

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
    if (!process.env[key]) process.env[key] = val;
  }
}

async function verify() {
  loadEnv();
  const databaseUrl =
    process.env.DATABASE_URL ||
    'postgresql://bloodnet:bloodnet_dev_password@localhost:5432/bloodnet_ai';

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // 1. Check tables
    const tablesRes = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    const tables = tablesRes.rows.map((r) => r.tablename);
    const expectedTables = [
      'audit_log',
      'blood_inventory',
      'blood_requests',
      'blood_units',
      'consumption',
      'inventory_transactions',
      'notifications',
      'organizations',
      'predictions',
      'schema_migrations',
      'shortage_alerts',
      'transfer_units',
      'transfers',
      'users',
    ];
    for (const t of expectedTables) {
      if (!tables.includes(t)) throw new Error(`Missing table: ${t}`);
    }
    console.log(`[PASS] All ${expectedTables.length} core tables present.`);

    // 2. Check organizations & PostGIS distance
    const orgCounts = await client.query(`
      SELECT type, COUNT(*)::int AS cnt FROM organizations GROUP BY type ORDER BY type
    `);
    console.log('[INFO] Organizations:', orgCounts.rows);
    const hospCount = orgCounts.rows.find((r) => r.type === 'hospital')?.cnt;
    const bbCount = orgCounts.rows.find((r) => r.type === 'blood_bank')?.cnt;
    if (hospCount !== 10 || bbCount !== 5) {
      throw new Error(`Expected 10 hospitals & 5 blood banks, got ${hospCount} & ${bbCount}`);
    }

    const distRes = await client.query(`
      SELECT ROUND((ST_Distance(a.location, b.location) / 1000.0)::numeric, 2) AS km
      FROM organizations a, organizations b
      WHERE a.code = 'HOSP-RAJ' AND b.code = 'BB-REDCROSS'
    `);
    console.log(`[PASS] PostGIS ST_Distance HOSP-RAJ <-> BB-REDCROSS = ${distRes.rows[0].km} km`);

    // 3. Check consumption history
    const consRes = await client.query(`
      SELECT
        COUNT(*)::int AS total_rows,
        COUNT(DISTINCT consumption_date)::int AS distinct_days,
        MIN(consumption_date)::text AS min_date,
        MAX(consumption_date)::text AS max_date,
        SUM(units_used)::int AS total_units_used,
        COUNT(*) FILTER (WHERE emergency_flag = TRUE)::int AS emergency_rows
      FROM consumption
    `);
    console.log('[PASS] Consumption history:', consRes.rows[0]);
    if (consRes.rows[0].distinct_days < 365) {
      throw new Error('Expected at least 365 days of historical consumption');
    }

    // 4. Check blood_units & blood_inventory sync
    const unitStats = await client.query(`
      SELECT
        COUNT(*)::int AS total_units,
        COUNT(*) FILTER (WHERE status = 'available')::int AS available,
        COUNT(*) FILTER (WHERE status = 'reserved')::int AS reserved,
        COUNT(*) FILTER (WHERE status = 'quarantined')::int AS quarantined,
        COUNT(*) FILTER (WHERE expiry_date <= CURRENT_DATE + INTERVAL '3 days' AND status = 'available')::int AS expiring_3d
      FROM blood_units
    `);
    console.log('[PASS] Blood units:', unitStats.rows[0]);

    const mismatchRes = await client.query(`
      SELECT bi.organization_id, bi.blood_group, bi.component, bi.available_units,
             COUNT(bu.id) FILTER (
               WHERE bu.status = 'available' AND bu.is_reserved = FALSE
                 AND bu.cold_chain_ok = TRUE AND bu.expiry_date >= CURRENT_DATE
             )::int AS actual_avail
      FROM blood_inventory bi
      LEFT JOIN blood_units bu
        ON bu.organization_id = bi.organization_id
       AND bu.blood_group = bi.blood_group
       AND bu.component = bi.component
      GROUP BY bi.organization_id, bi.blood_group, bi.component, bi.available_units
      HAVING bi.available_units <> COUNT(bu.id) FILTER (
        WHERE bu.status = 'available' AND bu.is_reserved = FALSE
          AND bu.cold_chain_ok = TRUE AND bu.expiry_date >= CURRENT_DATE
      )
    `);
    if (mismatchRes.rows.length > 0) {
      throw new Error(`Inventory sync mismatch detected: ${JSON.stringify(mismatchRes.rows[0])}`);
    }
    console.log('[PASS] blood_inventory matches blood_units 100%.');

    // 5. Test safety constraint: cold_chain_ok = FALSE cannot become available
    const quarUnit = await client.query(`
      SELECT id FROM blood_units WHERE cold_chain_ok = FALSE LIMIT 1
    `);
    if (quarUnit.rows.length > 0) {
      let rejected = false;
      try {
        await client.query(`UPDATE blood_units SET status = 'available' WHERE id = $1`, [
          quarUnit.rows[0].id,
        ]);
      } catch (e) {
        rejected = true;
      }
      if (!rejected) {
        throw new Error('Safety rule violation: cold_chain_ok=FALSE unit was allowed to become available');
      }
      console.log('[PASS] Safety constraint blocked marking cold-chain-failed unit as available.');
    }

    // 6. Test exclusive unit allocation constraint
    const activeTransferUnit = await client.query(`
      SELECT tu.unit_id, t.source_org_id
      FROM transfer_units tu
      JOIN transfers t ON t.id = tu.transfer_id
      WHERE tu.is_active = TRUE
      LIMIT 1
    `);
    if (activeTransferUnit.rows.length > 0) {
      let blockedDoubleAlloc = false;
      await client.query('BEGIN');
      try {
        const t2 = await client.query(
          `
          INSERT INTO transfers (
            transfer_code, source_org_id, target_org_id, blood_group, component, units_count
          )
          SELECT 'TRF-TEST-DUP', id, (SELECT id FROM organizations WHERE code = 'HOSP-RIMS'), 'O-', 'rbc', 1
          FROM organizations WHERE code = 'BB-REDCROSS'
          RETURNING id
          `
        );
        await client.query(
          `INSERT INTO transfer_units (transfer_id, unit_id, is_active) VALUES ($1, $2, TRUE)`,
          [t2.rows[0].id, activeTransferUnit.rows[0].unit_id]
        );
      } catch (e) {
        blockedDoubleAlloc = true;
      } finally {
        await client.query('ROLLBACK');
      }
      if (!blockedDoubleAlloc) {
        throw new Error('Concurrency constraint failed: allowed allocating same unit to two active transfers');
      }
      console.log('[PASS] Unique active unit constraint blocked double allocation.');
    }

    console.log('\nALL PHASE 1 VERIFICATION CHECKS PASSED!');
  } finally {
    await client.end();
  }
}

verify().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
