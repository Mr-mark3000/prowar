import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool';
import { authenticate, requireRoles, resolveScopedOrgId } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { recordAuditLog, recordInventoryTransaction } from '../utils/audit';
import {
  BLOOD_COMPONENTS,
  BLOOD_GROUPS,
  BloodComponent,
  COMPONENT_META,
  paramStr,
} from '../utils/constants';
import { evaluateShortageThreshold } from '../utils/thresholds';

const router = Router();

const createUnitSchema = z.object({
  organization_id: z.string().uuid().optional(),
  unit_code: z.string().min(4).max(48).optional(),
  blood_group: z.enum(BLOOD_GROUPS),
  component: z.enum(BLOOD_COMPONENTS),
  volume_ml: z.number().int().positive().optional(),
  collection_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cold_chain_ok: z.boolean().default(true),
  cold_chain_notes: z.string().max(500).optional(),
  quantity: z.number().int().min(1).max(50).default(1),
});

const separateSchema = z.object({
  components: z
    .array(z.enum(['rbc', 'platelets', 'plasma']))
    .min(1)
    .default(['rbc', 'platelets', 'plasma']),
});

const quarantineSchema = z.object({
  action: z.enum(['quarantine', 'discard']).default('quarantine'),
  reason: z.string().min(3).max(500),
});

const updateStatusSchema = z.object({
  status: z.enum(['available', 'expired', 'discarded', 'quarantined']),
  notes: z.string().max(500).optional(),
});

function addDaysIso(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const { organization_id, blood_group, component, low_stock_only } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (organization_id && typeof organization_id === 'string') {
      params.push(organization_id);
      conditions.push(`bi.organization_id = $${params.length}`);
    }
    if (blood_group && typeof blood_group === 'string') {
      params.push(blood_group);
      conditions.push(`bi.blood_group = $${params.length}`);
    }
    if (component && typeof component === 'string') {
      params.push(component);
      conditions.push(`bi.component = $${params.length}`);
    }
    if (low_stock_only === 'true') {
      conditions.push(`bi.available_units < bi.safety_stock_units`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await query(
      `
      SELECT bi.*, o.name AS organization_name, o.code AS organization_code, o.type AS organization_type
      FROM blood_inventory bi
      JOIN organizations o ON o.id = bi.organization_id
      ${where}
      ORDER BY o.name, bi.blood_group, bi.component
      `,
      params
    );

    res.json({ inventory: rows });
  })
);

router.get(
  '/units',
  authenticate,
  asyncHandler(async (req, res) => {
    const { organization_id, blood_group, component, status, expiring_within_days, limit = '100' } =
      req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (organization_id && typeof organization_id === 'string') {
      params.push(organization_id);
      conditions.push(`bu.organization_id = $${params.length}`);
    }
    if (blood_group && typeof blood_group === 'string') {
      params.push(blood_group);
      conditions.push(`bu.blood_group = $${params.length}`);
    }
    if (component && typeof component === 'string') {
      params.push(component);
      conditions.push(`bu.component = $${params.length}`);
    }
    if (status && typeof status === 'string') {
      params.push(status);
      conditions.push(`bu.status = $${params.length}`);
    }
    if (expiring_within_days && typeof expiring_within_days === 'string') {
      const days = Math.max(0, Math.min(90, Number(expiring_within_days) || 7));
      params.push(days);
      conditions.push(
        `bu.expiry_date <= CURRENT_DATE + ($${params.length}::int * INTERVAL '1 day') AND bu.expiry_date >= CURRENT_DATE`
      );
    }

    const lim = Math.max(1, Math.min(500, Number(limit) || 100));
    params.push(lim);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await query(
      `
      SELECT bu.*, o.name AS organization_name, o.code AS organization_code,
             GREATEST(0, (bu.expiry_date - CURRENT_DATE))::int AS days_until_expiry
      FROM blood_units bu
      JOIN organizations o ON o.id = bu.organization_id
      ${where}
      ORDER BY bu.expiry_date ASC, bu.created_at ASC
      LIMIT $${params.length}
      `,
      params
    );

    res.json({ units: rows });
  })
);

router.get(
  '/expiring',
  authenticate,
  asyncHandler(async (req, res) => {
    const days = Math.max(1, Math.min(60, Number(req.query.days) || 7));
    const orgId = typeof req.query.organization_id === 'string' ? req.query.organization_id : null;

    const params: unknown[] = [days];
    let orgFilter = '';
    if (orgId) {
      params.push(orgId);
      orgFilter = `AND bu.organization_id = $${params.length}`;
    }

    const { rows } = await query(
      `
      SELECT bu.id, bu.unit_code, bu.organization_id, o.name AS organization_name, o.type AS organization_type,
             bu.blood_group, bu.component, bu.collection_date, bu.expiry_date, bu.status,
             (bu.expiry_date - CURRENT_DATE)::int AS days_until_expiry
      FROM blood_units bu
      JOIN organizations o ON o.id = bu.organization_id
      WHERE bu.status = 'available'
        AND bu.is_reserved = FALSE
        AND bu.cold_chain_ok = TRUE
        AND bu.expiry_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + ($1::int * INTERVAL '1 day'))
        ${orgFilter}
      ORDER BY bu.expiry_date ASC
      LIMIT 200
      `,
      params
    );

    res.json({ days_window: days, expiring_units: rows });
  })
);

router.post(
  '/units',
  authenticate,
  requireRoles('central_admin', 'blood_bank_staff', 'hospital_staff'),
  asyncHandler(async (req, res) => {
    const body = createUnitSchema.parse(req.body);
    const orgId = resolveScopedOrgId(req.user!, body.organization_id);
    const meta = COMPONENT_META[body.component];
    const expiryDate = body.expiry_date || addDaysIso(body.collection_date, meta.shelfLifeDays);
    const volumeMl = body.volume_ml || meta.defaultVolumeMl;
    const status = body.cold_chain_ok ? 'available' : 'quarantined';

    if (body.quantity > 1 && body.unit_code) {
      throw new AppError(400, 'Cannot specify a fixed unit_code when quantity > 1', 'BAD_REQUEST');
    }

    const createdUnits = await withTransaction(async (client) => {
      const inserted: Record<string, unknown>[] = [];
      for (let i = 0; i < body.quantity; i++) {
        const unitCode =
          body.unit_code ||
          `JH-RNC-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

        const { rows } = await client.query(
          `
          INSERT INTO blood_units (
            unit_code, organization_id, blood_group, component, volume_ml,
            collection_date, expiry_date, status, is_reserved, cold_chain_ok, cold_chain_notes
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, $9, $10)
          RETURNING *
          `,
          [
            unitCode,
            orgId,
            body.blood_group,
            body.component,
            volumeMl,
            body.collection_date,
            expiryDate,
            status,
            body.cold_chain_ok,
            body.cold_chain_notes ?? null,
          ]
        );
        const unit = rows[0];
        inserted.push(unit);

        await recordInventoryTransaction(
          {
            unitId: unit.id,
            organizationId: orgId,
            transactionType: body.cold_chain_ok ? 'collect' : 'quarantine',
            deltaUnits: body.cold_chain_ok ? 1 : 0,
            previousStatus: null,
            newStatus: status,
            performedBy: req.user!.id,
            notes: `Registered unit ${unit.unit_code}`,
          },
          client
        );
      }

      await recordAuditLog(
        {
          actorUserId: req.user!.id,
          actorRole: req.user!.role,
          organizationId: orgId,
          action: 'REGISTER_BLOOD_UNITS',
          entityType: 'blood_unit',
          entityId: inserted.length === 1 ? String(inserted[0].id) : `batch:${inserted.length}`,
          newValues: {
            count: inserted.length,
            blood_group: body.blood_group,
            component: body.component,
            cold_chain_ok: body.cold_chain_ok,
          },
          ipAddress: req.ip,
        },
        client
      );

      await evaluateShortageThreshold(orgId, body.blood_group, body.component, client);
      return inserted;
    });

    res.status(201).json({ units: createdUnits });
  })
);

router.post(
  '/units/:id/separate',
  authenticate,
  requireRoles('central_admin', 'blood_bank_staff'),
  asyncHandler(async (req, res) => {
    const id = paramStr(req.params.id);
    const body = separateSchema.parse(req.body);

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM blood_units WHERE id = $1 FOR UPDATE', [
        id,
      ]);
      const source = rows[0];
      if (!source) {
        throw new AppError(404, 'Blood unit not found', 'NOT_FOUND');
      }

      resolveScopedOrgId(req.user!, source.organization_id);

      if (source.component !== 'whole_blood') {
        throw new AppError(400, 'Only whole_blood units can be separated', 'INVALID_COMPONENT');
      }
      if (!source.cold_chain_ok || source.status !== 'available' || source.is_reserved) {
        throw new AppError(
          400,
          'Unit must be available, unreserved, and cold-chain intact to separate',
          'INVALID_UNIT_STATE'
        );
      }

      await client.query(
        `UPDATE blood_units SET status = 'separated', version = version + 1 WHERE id = $1`,
        [source.id]
      );

      await recordInventoryTransaction(
        {
          unitId: source.id,
          organizationId: source.organization_id,
          transactionType: 'separate',
          deltaUnits: -1,
          previousStatus: source.status,
          newStatus: 'separated',
          performedBy: req.user!.id,
          notes: `Separated ${source.unit_code} into ${body.components.join(', ')}`,
        },
        client
      );

      const children: Record<string, unknown>[] = [];
      const colDate =
        source.collection_date instanceof Date
          ? source.collection_date.toISOString().slice(0, 10)
          : String(source.collection_date).slice(0, 10);

      for (const comp of body.components) {
        const meta = COMPONENT_META[comp as BloodComponent];
        const childCode = `${source.unit_code}-${meta.shortCode}`;
        const childExpiry = addDaysIso(colDate, meta.shelfLifeDays);

        const childRes = await client.query(
          `
          INSERT INTO blood_units (
            unit_code, organization_id, source_unit_id, blood_group, component,
            volume_ml, collection_date, expiry_date, status, is_reserved, cold_chain_ok
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'available', FALSE, TRUE)
          RETURNING *
          `,
          [
            childCode,
            source.organization_id,
            source.id,
            source.blood_group,
            comp,
            meta.defaultVolumeMl,
            colDate,
            childExpiry,
          ]
        );
        const child = childRes.rows[0];
        children.push(child);

        await recordInventoryTransaction(
          {
            unitId: child.id,
            organizationId: source.organization_id,
            transactionType: 'collect',
            deltaUnits: 1,
            previousStatus: null,
            newStatus: 'available',
            performedBy: req.user!.id,
            referenceId: source.id,
            notes: `Derived from whole blood unit ${source.unit_code}`,
          },
          client
        );

        await evaluateShortageThreshold(source.organization_id, source.blood_group, comp, client);
      }

      await recordAuditLog(
        {
          actorUserId: req.user!.id,
          actorRole: req.user!.role,
          organizationId: source.organization_id,
          action: 'SEPARATE_BLOOD_UNIT',
          entityType: 'blood_unit',
          entityId: source.id,
          oldValues: { status: source.status, component: source.component },
          newValues: { status: 'separated', derived_components: body.components },
          ipAddress: req.ip,
        },
        client
      );

      return { source_unit_id: source.id, derived_units: children };
    });

    res.status(201).json(result);
  })
);

router.patch(
  '/units/:id/quarantine',
  authenticate,
  requireRoles('central_admin', 'blood_bank_staff', 'hospital_staff'),
  asyncHandler(async (req, res) => {
    const id = paramStr(req.params.id);
    const body = quarantineSchema.parse(req.body);

    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM blood_units WHERE id = $1 FOR UPDATE', [
        id,
      ]);
      const unit = rows[0];
      if (!unit) throw new AppError(404, 'Blood unit not found', 'NOT_FOUND');

      resolveScopedOrgId(req.user!, unit.organization_id);

      const newStatus = body.action === 'discard' ? 'discarded' : 'quarantined';
      const { rows: updatedRows } = await client.query(
        `
        UPDATE blood_units
        SET status = $2,
            is_reserved = FALSE,
            cold_chain_ok = FALSE,
            cold_chain_notes = $3,
            version = version + 1
        WHERE id = $1
        RETURNING *
        `,
        [id, newStatus, body.reason]
      );

      await recordInventoryTransaction(
        {
          unitId: id,
          organizationId: unit.organization_id,
          transactionType: body.action === 'discard' ? 'discard' : 'quarantine',
          deltaUnits: unit.status === 'available' ? -1 : 0,
          previousStatus: unit.status,
          newStatus,
          performedBy: req.user!.id,
          notes: body.reason,
        },
        client
      );

      await recordAuditLog(
        {
          actorUserId: req.user!.id,
          actorRole: req.user!.role,
          organizationId: unit.organization_id,
          action: body.action === 'discard' ? 'DISCARD_UNIT' : 'QUARANTINE_UNIT',
          entityType: 'blood_unit',
          entityId: id,
          oldValues: { status: unit.status, cold_chain_ok: unit.cold_chain_ok },
          newValues: { status: newStatus, cold_chain_ok: false, reason: body.reason },
          ipAddress: req.ip,
        },
        client
      );

      await evaluateShortageThreshold(unit.organization_id, unit.blood_group, unit.component, client);
      return updatedRows[0];
    });

    res.json({ unit: updated });
  })
);

router.patch(
  '/units/:id/status',
  authenticate,
  requireRoles('central_admin', 'blood_bank_staff', 'hospital_staff'),
  asyncHandler(async (req, res) => {
    const id = paramStr(req.params.id);
    const body = updateStatusSchema.parse(req.body);

    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM blood_units WHERE id = $1 FOR UPDATE', [
        id,
      ]);
      const unit = rows[0];
      if (!unit) throw new AppError(404, 'Blood unit not found', 'NOT_FOUND');

      resolveScopedOrgId(req.user!, unit.organization_id);

      // Explicit safety rule enforcement (in addition to DB CHECK constraint)
      if (!unit.cold_chain_ok && body.status === 'available') {
        throw new AppError(
          400,
          'Safety rule: compromised/cold-chain-failed units can never be marked available',
          'COLD_CHAIN_SAFETY_VIOLATION'
        );
      }

      const { rows: updatedRows } = await client.query(
        `UPDATE blood_units SET status = $2, version = version + 1 WHERE id = $1 RETURNING *`,
        [id, body.status]
      );

      await recordAuditLog(
        {
          actorUserId: req.user!.id,
          actorRole: req.user!.role,
          organizationId: unit.organization_id,
          action: 'UPDATE_UNIT_STATUS',
          entityType: 'blood_unit',
          entityId: id,
          oldValues: { status: unit.status },
          newValues: { status: body.status, notes: body.notes ?? null },
          ipAddress: req.ip,
        },
        client
      );

      await evaluateShortageThreshold(unit.organization_id, unit.blood_group, unit.component, client);
      return updatedRows[0];
    });

    res.json({ unit: updated });
  })
);

export default router;
