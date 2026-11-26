import { Router } from 'express';
import { query } from '../db/pool';
import { authenticate, requireRoles } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { recordAuditLog } from '../utils/audit';
import { paramStr } from '../utils/constants';

const router = Router();

router.get(
  '/alerts',
  authenticate,
  asyncHandler(async (req, res) => {
    const { status, risk_level, organization_id } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status && typeof status === 'string') {
      params.push(status);
      conditions.push(`sa.status = $${params.length}`);
    }
    if (risk_level && typeof risk_level === 'string') {
      params.push(risk_level);
      conditions.push(`sa.risk_level = $${params.length}`);
    }
    if (organization_id && typeof organization_id === 'string') {
      params.push(organization_id);
      conditions.push(`sa.organization_id = $${params.length}`);
    } else if (
      (req.user!.role === 'hospital_staff' || req.user!.role === 'blood_bank_staff') &&
      req.user!.organizationId
    ) {
      params.push(req.user!.organizationId);
      conditions.push(`sa.organization_id = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await query(
      `
      SELECT sa.*, o.name AS organization_name, o.code AS organization_code, o.type AS organization_type
      FROM shortage_alerts sa
      JOIN organizations o ON o.id = sa.organization_id
      ${where}
      ORDER BY
        CASE sa.risk_level WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END,
        sa.created_at DESC
      LIMIT 200
      `,
      params
    );

    res.json({ alerts: rows });
  })
);

router.patch(
  '/alerts/:id/acknowledge',
  authenticate,
  asyncHandler(async (req, res) => {
    const id = paramStr(req.params.id);
    const { rows } = await query(
      `
      UPDATE shortage_alerts
      SET status = 'acknowledged',
          acknowledged_by = $2,
          acknowledged_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [id, req.user!.id]
    );
    if (rows.length === 0) throw new AppError(404, 'Alert not found', 'NOT_FOUND');

    await recordAuditLog({
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      organizationId: rows[0].organization_id,
      action: 'ACKNOWLEDGE_SHORTAGE_ALERT',
      entityType: 'shortage_alert',
      entityId: id,
      ipAddress: req.ip,
    });

    res.json({ alert: rows[0] });
  })
);

router.get(
  '/notifications',
  authenticate,
  asyncHandler(async (req, res) => {
    const params: unknown[] = [req.user!.id, req.user!.role];
    let orgClause = '';
    if (req.user!.organizationId) {
      params.push(req.user!.organizationId);
      orgClause = `OR n.organization_id = $${params.length}`;
    }

    const { rows } = await query(
      `
      SELECT n.*, o.name AS organization_name
      FROM notifications n
      LEFT JOIN organizations o ON o.id = n.organization_id
      WHERE (
        n.user_id = $1
        OR n.target_role = $2
        OR ($2 IN ('central_admin', 'regional_authority'))
        ${orgClause}
      )
      ORDER BY n.is_read ASC, n.created_at DESC
      LIMIT 100
      `,
      params
    );

    res.json({ notifications: rows });
  })
);

router.patch(
  '/notifications/:id/read',
  authenticate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { rows } = await query(
      `UPDATE notifications SET is_read = TRUE WHERE id = $1 RETURNING *`,
      [id]
    );
    if (rows.length === 0) throw new AppError(404, 'Notification not found', 'NOT_FOUND');
    res.json({ notification: rows[0] });
  })
);

router.get(
  '/audit-logs',
  authenticate,
  requireRoles('central_admin', 'regional_authority'),
  asyncHandler(async (req, res) => {
    const { entity_type, action, limit = '100' } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (entity_type && typeof entity_type === 'string') {
      params.push(entity_type);
      conditions.push(`al.entity_type = $${params.length}`);
    }
    if (action && typeof action === 'string') {
      params.push(action);
      conditions.push(`al.action = $${params.length}`);
    }

    const lim = Math.max(1, Math.min(500, Number(limit) || 100));
    params.push(lim);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await query(
      `
      SELECT al.*, u.email AS actor_email, u.full_name AS actor_name, o.name AS organization_name
      FROM audit_log al
      LEFT JOIN users u ON u.id = al.actor_user_id
      LEFT JOIN organizations o ON o.id = al.organization_id
      ${where}
      ORDER BY al.created_at DESC
      LIMIT $${params.length}
      `,
      params
    );

    res.json({ audit_logs: rows });
  })
);

export default router;
