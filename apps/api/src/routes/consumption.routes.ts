import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool';
import { authenticate, requireRoles, resolveScopedOrgId } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { recordAuditLog, recordInventoryTransaction } from '../utils/audit';
import { BLOOD_COMPONENTS, BLOOD_GROUPS, containsForbiddenPii } from '../utils/constants';
import { evaluateShortageThreshold } from '../utils/thresholds';

const router = Router();

const recordConsumptionSchema = z.object({
  organization_id: z.string().uuid().optional(),
  blood_group: z.enum(BLOOD_GROUPS),
  component: z.enum(BLOOD_COMPONENTS),
  consumption_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  units_used: z.number().int().min(1).max(200),
  emergency_flag: z.boolean().default(false),
  unit_ids: z.array(z.string().uuid()).optional(),
  notes: z.string().max(500).optional(),
});

router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const { organization_id, blood_group, component, from, to, aggregate = 'daily' } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (organization_id && typeof organization_id === 'string') {
      params.push(organization_id);
      conditions.push(`c.organization_id = $${params.length}`);
    }
    if (blood_group && typeof blood_group === 'string') {
      params.push(blood_group);
      conditions.push(`c.blood_group = $${params.length}`);
    }
    if (component && typeof component === 'string') {
      params.push(component);
      conditions.push(`c.component = $${params.length}`);
    }
    if (from && typeof from === 'string') {
      params.push(from);
      conditions.push(`c.consumption_date >= $${params.length}::date`);
    }
    if (to && typeof to === 'string') {
      params.push(to);
      conditions.push(`c.consumption_date <= $${params.length}::date`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    if (aggregate === 'timeseries') {
      const { rows } = await query(
        `
        SELECT c.consumption_date::text AS date,
               SUM(c.units_used)::int AS total_units,
               SUM(c.emergency_units)::int AS emergency_units
        FROM consumption c
        ${where}
        GROUP BY c.consumption_date
        ORDER BY c.consumption_date ASC
        LIMIT 730
        `,
        params
      );
      res.json({ series: rows });
      return;
    }

    const { rows } = await query(
      `
      SELECT c.id, c.organization_id, o.name AS organization_name, o.code AS organization_code,
             c.blood_group, c.component, c.consumption_date::text AS consumption_date,
             c.units_used, c.emergency_units, c.emergency_flag, c.source, c.notes, c.created_at
      FROM consumption c
      JOIN organizations o ON o.id = c.organization_id
      ${where}
      ORDER BY c.consumption_date DESC, c.created_at DESC
      LIMIT 300
      `,
      params
    );

    res.json({ consumption: rows });
  })
);

router.post(
  '/',
  authenticate,
  requireRoles('central_admin', 'hospital_staff', 'blood_bank_staff'),
  asyncHandler(async (req, res) => {
    const piiField = containsForbiddenPii(req.body);
    if (piiField) {
      throw new AppError(
        400,
        `Patient-identifiable field '${piiField}' is prohibited in BloodNet AI`,
        'PII_PROHIBITED'
      );
    }

    const body = recordConsumptionSchema.parse(req.body);
    const orgId = resolveScopedOrgId(req.user!, body.organization_id);
    const consumptionDate = body.consumption_date || new Date().toISOString().slice(0, 10);

    const outcome = await withTransaction(async (client) => {
      let lockedUnits: { id: string; unit_code: string; status: string }[] = [];

      if (body.unit_ids && body.unit_ids.length > 0) {
        if (body.unit_ids.length !== body.units_used) {
          throw new AppError(
            400,
            'unit_ids length must match units_used when specific units are provided',
            'UNIT_COUNT_MISMATCH'
          );
        }
        const { rows } = await client.query<{ id: string; unit_code: string; status: string }>(
          `
          SELECT id, unit_code, status FROM blood_units
          WHERE id = ANY($1::uuid[])
            AND organization_id = $2
            AND blood_group = $3
            AND component = $4
            AND status = 'available'
            AND is_reserved = FALSE
            AND cold_chain_ok = TRUE
          FOR UPDATE
          `,
          [body.unit_ids, orgId, body.blood_group, body.component]
        );
        if (rows.length !== body.unit_ids.length) {
          throw new AppError(
            409,
            'One or more specified blood units are unavailable, reserved, or failed cold chain',
            'UNITS_UNAVAILABLE'
          );
        }
        lockedUnits = rows;
      } else {
        // Consume available units in FEFO order (oldest valid expiry first)
        const { rows } = await client.query<{ id: string; unit_code: string; status: string }>(
          `
          SELECT id, unit_code, status FROM blood_units
          WHERE organization_id = $1
            AND blood_group = $2
            AND component = $3
            AND status = 'available'
            AND is_reserved = FALSE
            AND cold_chain_ok = TRUE
            AND expiry_date >= CURRENT_DATE
          ORDER BY expiry_date ASC, created_at ASC
          LIMIT $4
          FOR UPDATE SKIP LOCKED
          `,
          [orgId, body.blood_group, body.component, body.units_used]
        );
        if (rows.length < body.units_used) {
          throw new AppError(
            409,
            `Insufficient unreserved stock: requested ${body.units_used}, available ${rows.length}`,
            'INSUFFICIENT_STOCK'
          );
        }
        lockedUnits = rows;
      }

      for (const u of lockedUnits) {
        await client.query(
          `UPDATE blood_units SET status = 'transfused', version = version + 1 WHERE id = $1`,
          [u.id]
        );
        await recordInventoryTransaction(
          {
            unitId: u.id,
            organizationId: orgId,
            transactionType: 'consume',
            deltaUnits: -1,
            previousStatus: u.status,
            newStatus: 'transfused',
            performedBy: req.user!.id,
            notes: body.notes ?? 'Clinical transfusion consumption recorded',
          },
          client
        );
      }

      const emergencyUnits = body.emergency_flag ? body.units_used : 0;
      const { rows: consRows } = await client.query(
        `
        INSERT INTO consumption (
          organization_id, blood_group, component, consumption_date,
          units_used, emergency_units, emergency_flag, unit_id, recorded_by, source, notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual', $10)
        RETURNING *
        `,
        [
          orgId,
          body.blood_group,
          body.component,
          consumptionDate,
          body.units_used,
          emergencyUnits,
          body.emergency_flag,
          lockedUnits.length === 1 ? lockedUnits[0].id : null,
          req.user!.id,
          body.notes ?? null,
        ]
      );

      await recordAuditLog(
        {
          actorUserId: req.user!.id,
          actorRole: req.user!.role,
          organizationId: orgId,
          action: 'RECORD_CONSUMPTION',
          entityType: 'consumption',
          entityId: consRows[0].id,
          newValues: {
            blood_group: body.blood_group,
            component: body.component,
            units_used: body.units_used,
            emergency_flag: body.emergency_flag,
            consumed_unit_codes: lockedUnits.map((u) => u.unit_code),
          },
          ipAddress: req.ip,
        },
        client
      );

      const threshold = await evaluateShortageThreshold(
        orgId,
        body.blood_group,
        body.component,
        client
      );

      return {
        consumption: consRows[0],
        consumed_units: lockedUnits.map((u) => u.unit_code),
        threshold_check: threshold,
      };
    });

    res.status(201).json(outcome);
  })
);

export default router;
