import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool';
import { authenticate, requireRoles } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { recordAuditLog } from '../utils/audit';
import { BLOOD_COMPONENTS, BLOOD_GROUPS, paramStr } from '../utils/constants';

const router = Router();

const createOrgSchema = z.object({
  code: z.string().min(3).max(32),
  name: z.string().min(2).max(200),
  type: z.enum(['hospital', 'blood_bank', 'collection_center']),
  district: z.string().min(2).max(100).default('Ranchi'),
  state: z.string().min(2).max(100).default('Jharkhand'),
  address: z.string().min(5),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  contact_phone: z.string().max(32).optional(),
  contact_email: z.string().email().optional(),
  storage_capacity_units: z.number().int().positive().default(250),
  safety_stock_days: z.number().int().min(1).max(30).default(5),
});

const updateOrgSchema = createOrgSchema.partial().omit({ code: true }).extend({
  is_active: z.boolean().optional(),
});

router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const { type, district, search } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (type && typeof type === 'string') {
      params.push(type);
      conditions.push(`o.type = $${params.length}`);
    }
    if (district && typeof district === 'string') {
      params.push(district);
      conditions.push(`LOWER(o.district) = LOWER($${params.length})`);
    }
    if (search && typeof search === 'string') {
      params.push(`%${search}%`);
      conditions.push(`(o.name ILIKE $${params.length} OR o.code ILIKE $${params.length})`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await query(
      `
      SELECT o.id, o.code, o.name, o.type, o.district, o.state, o.address,
             o.lat, o.lng, o.contact_phone, o.contact_email,
             o.storage_capacity_units, o.safety_stock_days, o.is_active, o.created_at,
             COALESCE(SUM(bi.available_units), 0)::int AS total_available_units,
             COALESCE(SUM(bi.reserved_units), 0)::int AS total_reserved_units,
             COALESCE(SUM(bi.expiring_within_7d_units), 0)::int AS expiring_within_7d_units,
             COALESCE(SUM(bi.quarantined_units), 0)::int AS quarantined_units,
             COALESCE(COUNT(DISTINCT sa.id) FILTER (WHERE sa.status = 'active'), 0)::int AS active_alerts_count
      FROM organizations o
      LEFT JOIN blood_inventory bi ON bi.organization_id = o.id
      LEFT JOIN shortage_alerts sa ON sa.organization_id = o.id AND sa.status = 'active'
      ${where}
      GROUP BY o.id
      ORDER BY o.type, o.name
      `,
      params
    );

    res.json({ organizations: rows });
  })
);

router.get(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const orgRes = await query(
      `
      SELECT id, code, name, type, district, state, address, lat, lng,
             contact_phone, contact_email, storage_capacity_units, safety_stock_days,
             is_active, created_at, updated_at
      FROM organizations WHERE id = $1
      `,
      [id]
    );

    if (orgRes.rows.length === 0) {
      throw new AppError(404, 'Organization not found', 'NOT_FOUND');
    }

    const [invRes, nearbyRes] = await Promise.all([
      query(
        `
        SELECT blood_group, component, total_units, available_units, reserved_units,
               in_transit_units, expiring_within_7d_units, quarantined_units, safety_stock_units, last_updated_at
        FROM blood_inventory
        WHERE organization_id = $1
        ORDER BY blood_group, component
        `,
        [id]
      ),
      query(
        `
        SELECT o2.id, o2.code, o2.name, o2.type, o2.lat, o2.lng,
               ROUND((ST_Distance(o1.location, o2.location) / 1000.0)::numeric, 2)::float AS distance_km
        FROM organizations o1
        JOIN organizations o2 ON o2.id <> o1.id AND o2.is_active = TRUE
        WHERE o1.id = $1
        ORDER BY o1.location <-> o2.location
        LIMIT 6
        `,
        [id]
      ),
    ]);

    res.json({
      organization: orgRes.rows[0],
      inventory: invRes.rows,
      nearby_organizations: nearbyRes.rows,
    });
  })
);

router.post(
  '/',
  authenticate,
  requireRoles('central_admin', 'regional_authority'),
  asyncHandler(async (req, res) => {
    const body = createOrgSchema.parse(req.body);

    const org = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `
        INSERT INTO organizations (
          code, name, type, district, state, address, lat, lng,
          contact_phone, contact_email, storage_capacity_units, safety_stock_days
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
        `,
        [
          body.code.toUpperCase(),
          body.name,
          body.type,
          body.district,
          body.state,
          body.address,
          body.lat,
          body.lng,
          body.contact_phone ?? null,
          body.contact_email ?? null,
          body.storage_capacity_units,
          body.safety_stock_days,
        ]
      );
      const created = rows[0];

      // Initialize all 32 inventory buckets for the new organization
      for (const bg of BLOOD_GROUPS) {
        for (const comp of BLOOD_COMPONENTS) {
          await client.query(
            `
            INSERT INTO blood_inventory (organization_id, blood_group, component, safety_stock_units)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT DO NOTHING
            `,
            [created.id, bg, comp, Math.max(2, body.safety_stock_days)]
          );
        }
      }

      await recordAuditLog(
        {
          actorUserId: req.user!.id,
          actorRole: req.user!.role,
          organizationId: created.id,
          action: 'CREATE_ORGANIZATION',
          entityType: 'organization',
          entityId: created.id,
          newValues: created,
          ipAddress: req.ip,
        },
        client
      );

      return created;
    });

    res.status(201).json({ organization: org });
  })
);

router.patch(
  '/:id',
  authenticate,
  requireRoles('central_admin', 'regional_authority'),
  asyncHandler(async (req, res) => {
    const id = paramStr(req.params.id);
    const body = updateOrgSchema.parse(req.body);

    const updated = await withTransaction(async (client) => {
      const existing = await client.query('SELECT * FROM organizations WHERE id = $1 FOR UPDATE', [
        id,
      ]);
      if (existing.rows.length === 0) {
        throw new AppError(404, 'Organization not found', 'NOT_FOUND');
      }

      const fields = Object.entries(body).filter(([, v]) => v !== undefined);
      if (fields.length === 0) {
        return existing.rows[0];
      }

      const setClauses = fields.map(([k], idx) => `${k} = $${idx + 2}`);
      const values = fields.map(([, v]) => v);
      const { rows } = await client.query(
        `UPDATE organizations SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id, ...values]
      );

      await recordAuditLog(
        {
          actorUserId: req.user!.id,
          actorRole: req.user!.role,
          organizationId: id,
          action: 'UPDATE_ORGANIZATION',
          entityType: 'organization',
          entityId: id,
          oldValues: existing.rows[0],
          newValues: rows[0],
          ipAddress: req.ip,
        },
        client
      );

      return rows[0];
    });

    res.json({ organization: updated });
  })
);

export default router;
