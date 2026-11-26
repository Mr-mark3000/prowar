import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool';
import { authenticate, requireRoles, resolveScopedOrgId } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { recordAuditLog } from '../utils/audit';
import {
  BLOOD_COMPONENTS,
  BLOOD_GROUPS,
  RBC_COMPATIBLE_DONORS,
  containsForbiddenPii,
} from '../utils/constants';

const router = Router();

const createRequestSchema = z.object({
  requesting_org_id: z.string().uuid().optional(),
  blood_group: z.enum(BLOOD_GROUPS),
  component: z.enum(BLOOD_COMPONENTS),
  units_requested: z.number().int().min(1).max(200),
  urgency: z.enum(['routine', 'urgent', 'emergency']).default('routine'),
  required_by: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
});

router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const { status, urgency, organization_id } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status && typeof status === 'string') {
      params.push(status);
      conditions.push(`br.status = $${params.length}`);
    }
    if (urgency && typeof urgency === 'string') {
      params.push(urgency);
      conditions.push(`br.urgency = $${params.length}`);
    }
    if (organization_id && typeof organization_id === 'string') {
      params.push(organization_id);
      conditions.push(`br.requesting_org_id = $${params.length}`);
    } else if (req.user!.role === 'hospital_staff' && req.user!.organizationId) {
      params.push(req.user!.organizationId);
      conditions.push(`br.requesting_org_id = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await query(
      `
      SELECT br.*, o.name AS requesting_org_name, o.code AS requesting_org_code,
             o.lat AS requesting_org_lat, o.lng AS requesting_org_lng
      FROM blood_requests br
      JOIN organizations o ON o.id = br.requesting_org_id
      ${where}
      ORDER BY
        CASE br.urgency WHEN 'emergency' THEN 1 WHEN 'urgent' THEN 2 ELSE 3 END,
        br.created_at DESC
      LIMIT 200
      `,
      params
    );

    res.json({ requests: rows });
  })
);

router.post(
  '/',
  authenticate,
  requireRoles('central_admin', 'hospital_staff'),
  asyncHandler(async (req, res) => {
    const piiField = containsForbiddenPii(req.body);
    if (piiField) {
      throw new AppError(400, `Patient-identifiable field '${piiField}' is prohibited`, 'PII_PROHIBITED');
    }

    const body = createRequestSchema.parse(req.body);
    const orgId = resolveScopedOrgId(req.user!, body.requesting_org_id);
    const requiredBy =
      body.required_by ||
      new Date(Date.now() + (body.urgency === 'emergency' ? 2 : 12) * 3600 * 1000).toISOString();

    const created = await withTransaction(async (client) => {
      const reqCode = `REQ-RNC-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const { rows } = await client.query(
        `
        INSERT INTO blood_requests (
          request_code, requesting_org_id, blood_group, component,
          units_requested, urgency, status, required_by, notes, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9)
        RETURNING *
        `,
        [
          reqCode,
          orgId,
          body.blood_group,
          body.component,
          body.units_requested,
          body.urgency,
          requiredBy,
          body.notes ?? null,
          req.user!.id,
        ]
      );
      const requestRow = rows[0];

      await client.query(
        `
        INSERT INTO notifications (
          organization_id, target_role, title, message, severity, category, metadata
        )
        VALUES (
          $1, 'blood_bank_staff', $2, $3, $4, $5, $6::jsonb
        )
        `,
        [
          orgId,
          `${body.urgency.toUpperCase()} Blood Request: ${body.units_requested}x ${body.blood_group} ${body.component}`,
          `Request ${reqCode} created for ${body.units_requested} units (${body.blood_group} ${body.component}).`,
          body.urgency === 'emergency' ? 'critical' : body.urgency === 'urgent' ? 'high' : 'info',
          body.urgency === 'emergency' ? 'emergency' : 'transfer',
          JSON.stringify({ request_id: requestRow.id, request_code: reqCode }),
        ]
      );

      await recordAuditLog(
        {
          actorUserId: req.user!.id,
          actorRole: req.user!.role,
          organizationId: orgId,
          action: 'CREATE_BLOOD_REQUEST',
          entityType: 'blood_request',
          entityId: requestRow.id,
          newValues: requestRow,
          ipAddress: req.ip,
        },
        client
      );

      return requestRow;
    });

    res.status(201).json({ request: created });
  })
);

/**
 * Advisory blood availability matching using PostGIS distance, unreserved FEFO stock,
 * and source safety stock buffer. Human approval is still required via /api/transfers.
 */
router.get(
  '/:id/matches',
  authenticate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const reqRes = await query<{
      id: string;
      requesting_org_id: string;
      blood_group: keyof typeof RBC_COMPATIBLE_DONORS;
      component: string;
      units_requested: number;
      units_fulfilled: number;
    }>('SELECT * FROM blood_requests WHERE id = $1', [id]);

    if (reqRes.rows.length === 0) {
      throw new AppError(404, 'Blood request not found', 'NOT_FOUND');
    }

    const br = reqRes.rows[0];
    const compatibleGroups =
      br.component === 'rbc' || br.component === 'whole_blood'
        ? RBC_COMPATIBLE_DONORS[br.blood_group]
        : [br.blood_group];

    const { rows } = await query(
      `
      SELECT o.id AS source_org_id, o.code, o.name, o.type, o.lat, o.lng,
             bi.blood_group, bi.component, bi.available_units, bi.safety_stock_units,
             GREATEST(0, bi.available_units - bi.safety_stock_units)::int AS surplus_units,
             bi.expiring_within_7d_units,
             ROUND((ST_Distance(req_org.location, o.location) / 1000.0)::numeric, 2)::float AS distance_km,
             GREATEST(5, ROUND(((ST_Distance(req_org.location, o.location) / 1000.0) / 28.0) * 60)::int) AS eta_minutes,
             (bi.blood_group = $3) AS is_exact_group_match
      FROM organizations req_org
      JOIN organizations o ON o.id <> req_org.id AND o.is_active = TRUE
      JOIN blood_inventory bi ON bi.organization_id = o.id
      WHERE req_org.id = $1
        AND bi.component = $2
        AND bi.blood_group = ANY($4::varchar[])
        AND bi.available_units > 0
      ORDER BY
        is_exact_group_match DESC,
        (bi.available_units - bi.safety_stock_units) DESC,
        distance_km ASC
      LIMIT 15
      `,
      [br.requesting_org_id, br.component, br.blood_group, compatibleGroups]
    );

    res.json({
      request: br,
      compatible_groups: compatibleGroups,
      matches: rows,
      advisory_note: 'Advisory match only; human clinical approval required before transfer dispatch.',
    });
  })
);

export default router;
