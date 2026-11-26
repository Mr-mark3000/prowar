import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { pool } from '../src/db/pool';

const app = createApp();

let adminToken = '';
let rajHospitalToken = '';
let redcrossToken = '';
let rajOrgId = '';
let rimsHospOrgId = '';
let redcrossOrgId = '';

const createdUnitIds: string[] = [];
const createdRequestIds: string[] = [];
const createdTransferIds: string[] = [];

async function login(email: string, password = 'BloodNet@2026') {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  expect(res.body.token).toBeTruthy();
  return res.body;
}

describe('BloodNet AI Phase 2 API Integration & Concurrency Tests', () => {
  beforeAll(async () => {
    const admin = await login('admin@bloodnet.jh.gov.pilot');
    adminToken = admin.token;

    const raj = await login('staff@rajhospital.pilot');
    rajHospitalToken = raj.token;
    rajOrgId = raj.user.organization_id;

    const redcross = await login('bb@redcrossranchi.pilot');
    redcrossToken = redcross.token;
    redcrossOrgId = redcross.user.organization_id;

    const orgsRes = await request(app)
      .get('/api/organizations?type=hospital')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(orgsRes.status).toBe(200);
    const rims = orgsRes.body.organizations.find((o: { code: string }) => o.code === 'HOSP-RIMS');
    rimsHospOrgId = rims.id;
  });

  afterAll(async () => {
    // Clean up test-created rows so seeded DB stays tidy
    if (createdTransferIds.length > 0) {
      await pool.query('DELETE FROM transfer_units WHERE transfer_id = ANY($1::uuid[])', [
        createdTransferIds,
      ]);
      await pool.query('DELETE FROM transfers WHERE id = ANY($1::uuid[])', [createdTransferIds]);
    }
    if (createdRequestIds.length > 0) {
      await pool.query('DELETE FROM blood_requests WHERE id = ANY($1::uuid[])', [
        createdRequestIds,
      ]);
    }
    if (createdUnitIds.length > 0) {
      await pool.query('DELETE FROM inventory_transactions WHERE unit_id = ANY($1::uuid[])', [
        createdUnitIds,
      ]);
      await pool.query('DELETE FROM blood_units WHERE id = ANY($1::uuid[])', [createdUnitIds]);
    }
    await pool.end();
  });

  it('GET /health reports database connectivity', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.db).toBe('connected');
  });

  it('enforces authentication and RBAC role & org scoping', async () => {
    const unauth = await request(app).get('/api/organizations');
    expect(unauth.status).toBe(401);

    const badPass = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@bloodnet.jh.gov.pilot', password: 'WrongPassword' });
    expect(badPass.status).toBe(401);

    // Hospital staff cannot create organizations
    const forbiddenOrg = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${rajHospitalToken}`)
      .send({
        code: 'HOSP-FAKE',
        name: 'Fake Hospital',
        type: 'hospital',
        address: 'Ranchi',
        lat: 23.35,
        lng: 85.33,
      });
    expect(forbiddenOrg.status).toBe(403);

    // Hospital staff cannot register units for another organization
    const crossOrgUnit = await request(app)
      .post('/api/inventory/units')
      .set('Authorization', `Bearer ${rajHospitalToken}`)
      .send({
        organization_id: rimsHospOrgId,
        blood_group: 'O+',
        component: 'rbc',
        collection_date: '2026-11-25',
      });
    expect(crossOrgUnit.status).toBe(403);
  });

  it('registers whole_blood unit, separates into components, and enforces cold-chain safety', async () => {
    const regRes = await request(app)
      .post('/api/inventory/units')
      .set('Authorization', `Bearer ${redcrossToken}`)
      .send({
        blood_group: 'A+',
        component: 'whole_blood',
        collection_date: '2026-11-25',
        quantity: 1,
      });
    expect(regRes.status).toBe(201);
    const wbUnit = regRes.body.units[0];
    createdUnitIds.push(wbUnit.id);

    const sepRes = await request(app)
      .post(`/api/inventory/units/${wbUnit.id}/separate`)
      .set('Authorization', `Bearer ${redcrossToken}`)
      .send({ components: ['rbc', 'platelets', 'plasma'] });
    expect(sepRes.status).toBe(201);
    expect(sepRes.body.derived_units).toHaveLength(3);
    for (const child of sepRes.body.derived_units) {
      createdUnitIds.push(child.id);
      expect(child.source_unit_id).toBe(wbUnit.id);
    }

    // Quarantine one derived unit and verify it can NEVER be restored to available
    const targetChildId = sepRes.body.derived_units[0].id;
    const quarRes = await request(app)
      .patch(`/api/inventory/units/${targetChildId}/quarantine`)
      .set('Authorization', `Bearer ${redcrossToken}`)
      .send({ action: 'quarantine', reason: 'Cold box temperature exceeded 6.5C' });
    expect(quarRes.status).toBe(200);
    expect(quarRes.body.unit.cold_chain_ok).toBe(false);
    expect(quarRes.body.unit.status).toBe('quarantined');

    const unsafeRestore = await request(app)
      .patch(`/api/inventory/units/${targetChildId}/status`)
      .set('Authorization', `Bearer ${redcrossToken}`)
      .send({ status: 'available' });
    expect(unsafeRestore.status).toBe(400);
    expect(unsafeRestore.body.code).toBe('COLD_CHAIN_SAFETY_VIOLATION');
  });

  it('rejects PII in consumption and records FEFO consumption with audit log', async () => {
    const piiAttempt = await request(app)
      .post('/api/consumption')
      .set('Authorization', `Bearer ${rajHospitalToken}`)
      .send({
        blood_group: 'O+',
        component: 'rbc',
        units_used: 1,
        patient_name: 'Should Be Rejected',
      });
    expect(piiAttempt.status).toBe(400);
    expect(piiAttempt.body.code).toBe('PII_PROHIBITED');

    // Register a unit for Raj Hospital so consumption is guaranteed deterministic
    const reg = await request(app)
      .post('/api/inventory/units')
      .set('Authorization', `Bearer ${rajHospitalToken}`)
      .send({
        blood_group: 'AB+',
        component: 'plasma',
        collection_date: '2026-11-24',
        quantity: 1,
      });
    expect(reg.status).toBe(201);
    const unit = reg.body.units[0];
    createdUnitIds.push(unit.id);

    const consRes = await request(app)
      .post('/api/consumption')
      .set('Authorization', `Bearer ${rajHospitalToken}`)
      .send({
        blood_group: 'AB+',
        component: 'plasma',
        units_used: 1,
        unit_ids: [unit.id],
        emergency_flag: true,
        notes: 'Test emergency surgical transfusion',
      });
    expect(consRes.status).toBe(201);
    expect(consRes.body.consumed_units).toEqual([unit.unit_code]);

    // Verify audit log recorded it
    const auditRes = await request(app)
      .get('/api/audit-logs?action=RECORD_CONSUMPTION&limit=5')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(auditRes.status).toBe(200);
    expect(
      auditRes.body.audit_logs.some(
        (a: { entity_id: string }) => a.entity_id === consRes.body.consumption.id
      )
    ).toBe(true);
  });

  it('runs human-in-the-loop request -> match -> pending transfer -> approve -> dispatch -> complete', async () => {
    // 1. Register dedicated test unit at Red Cross Ranchi
    const reg = await request(app)
      .post('/api/inventory/units')
      .set('Authorization', `Bearer ${redcrossToken}`)
      .send({
        blood_group: 'B+',
        component: 'rbc',
        collection_date: '2026-11-25',
        quantity: 1,
      });
    expect(reg.status).toBe(201);
    const unit = reg.body.units[0];
    createdUnitIds.push(unit.id);

    // 2. Raj Hospital creates blood request
    const reqRes = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${rajHospitalToken}`)
      .send({
        blood_group: 'B+',
        component: 'rbc',
        units_requested: 1,
        urgency: 'urgent',
      });
    expect(reqRes.status).toBe(201);
    const bloodReq = reqRes.body.request;
    createdRequestIds.push(bloodReq.id);

    // 3. PostGIS matching returns nearby blood banks
    const matchRes = await request(app)
      .get(`/api/requests/${bloodReq.id}/matches`)
      .set('Authorization', `Bearer ${rajHospitalToken}`);
    expect(matchRes.status).toBe(200);
    expect(matchRes.body.matches.length).toBeGreaterThan(0);

    // 4. Propose transfer (MUST stay pending, never auto-approved)
    const trRes = await request(app)
      .post('/api/transfers')
      .set('Authorization', `Bearer ${rajHospitalToken}`)
      .send({
        source_org_id: redcrossOrgId,
        target_org_id: rajOrgId,
        request_id: bloodReq.id,
        blood_group: 'B+',
        component: 'rbc',
        units_count: 1,
        unit_ids: [unit.id],
      });
    expect(trRes.status).toBe(201);
    const transfer = trRes.body.transfer;
    createdTransferIds.push(transfer.id);
    expect(transfer.approval_status).toBe('pending');
    expect(transfer.approved_by).toBeNull();

    // 5. Cannot dispatch without human approval
    const earlyDispatch = await request(app)
      .post(`/api/transfers/${transfer.id}/dispatch`)
      .set('Authorization', `Bearer ${redcrossToken}`);
    expect(earlyDispatch.status).toBe(400);

    // 6. Hospital staff cannot approve on behalf of source blood bank
    const wrongApprover = await request(app)
      .post(`/api/transfers/${transfer.id}/approve`)
      .set('Authorization', `Bearer ${rajHospitalToken}`);
    expect(wrongApprover.status).toBe(403);

    // 7. Source blood bank staff approves, dispatches, and hospital completes receipt
    const approveRes = await request(app)
      .post(`/api/transfers/${transfer.id}/approve`)
      .set('Authorization', `Bearer ${redcrossToken}`);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.transfer.approval_status).toBe('approved');

    const dispatchRes = await request(app)
      .post(`/api/transfers/${transfer.id}/dispatch`)
      .set('Authorization', `Bearer ${redcrossToken}`);
    expect(dispatchRes.status).toBe(200);
    expect(dispatchRes.body.transfer.approval_status).toBe('in_transit');

    const completeRes = await request(app)
      .post(`/api/transfers/${transfer.id}/complete`)
      .set('Authorization', `Bearer ${rajHospitalToken}`);
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.transfer.approval_status).toBe('completed');

    // Verify unit ownership transferred to Raj Hospital & status is available
    const unitCheck = await pool.query(
      'SELECT organization_id, status, is_reserved FROM blood_units WHERE id = $1',
      [unit.id]
    );
    expect(unitCheck.rows[0].organization_id).toBe(rajOrgId);
    expect(unitCheck.rows[0].status).toBe('available');
    expect(unitCheck.rows[0].is_reserved).toBe(false);
  });

  it('prevents two concurrent organizations from allocating the exact same blood unit', async () => {
    const reg = await request(app)
      .post('/api/inventory/units')
      .set('Authorization', `Bearer ${redcrossToken}`)
      .send({
        blood_group: 'O-',
        component: 'rbc',
        collection_date: '2026-11-25',
        quantity: 1,
      });
    expect(reg.status).toBe(201);
    const sharedUnitId = reg.body.units[0].id;
    createdUnitIds.push(sharedUnitId);

    const [resA, resB] = await Promise.all([
      request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          source_org_id: redcrossOrgId,
          target_org_id: rajOrgId,
          blood_group: 'O-',
          component: 'rbc',
          units_count: 1,
          unit_ids: [sharedUnitId],
        }),
      request(app)
        .post('/api/transfers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          source_org_id: redcrossOrgId,
          target_org_id: rimsHospOrgId,
          blood_group: 'O-',
          component: 'rbc',
          units_count: 1,
          unit_ids: [sharedUnitId],
        }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winner = resA.status === 201 ? resA.body.transfer : resB.body.transfer;
    createdTransferIds.push(winner.id);

    // Reject the winning transfer and confirm the unit becomes available again
    const rejectRes = await request(app)
      .post(`/api/transfers/${winner.id}/reject`)
      .set('Authorization', `Bearer ${redcrossToken}`)
      .send({ rejection_reason: 'Concurrency test cleanup' });
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.transfer.approval_status).toBe('rejected');

    const unitCheck = await pool.query(
      'SELECT status, is_reserved FROM blood_units WHERE id = $1',
      [sharedUnitId]
    );
    expect(unitCheck.rows[0].status).toBe('available');
    expect(unitCheck.rows[0].is_reserved).toBe(false);
  });
});
