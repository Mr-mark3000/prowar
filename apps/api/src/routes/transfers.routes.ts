import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool';
import { authenticate, requireRoles } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { recordAuditLog, recordInventoryTransaction } from '../utils/audit';
import { BLOOD_COMPONENTS, BLOOD_GROUPS, paramStr } from '../utils/constants';
import { evaluateShortageThreshold } from '../utils/thresholds';

const router = Router();

const createTransferSchema = z.object({
  source_org_id: z.string().uuid(),
  target_org_id: z.string().uuid(),
  request_id: z.string().uuid().optional(),
  blood_group: z.enum(BLOOD_GROUPS),
  component: z.enum(BLOOD_COMPONENTS),
  units_count: z.number().int().min(1).max(100),
  unit_ids: z.array(z.string().uuid()).optional(),
  recommended_by_ai: z.boolean().default(false),
  ai_priority_rank: z.number().int().positive().optional(),
  ai_objective_score: z.number().optional(),
  ai_rationale: z.record(z.unknown()).optional(),
});

const rejectSchema = z.object({
  rejection_reason: z.string().min(3).max(500),
});

router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const { status, org_id } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status && typeof status === 'string') {
      params.push(status);
      conditions.push(`t.approval_status = $${params.length}`);
    }

    const scopedOrg =
      typeof org_id === 'string'
        ? org_id
        : req.user!.role === 'hospital_staff' || req.user!.role === 'blood_bank_staff'
          ? req.user!.organizationId
          : null;

    if (scopedOrg) {
      params.push(scopedOrg);
      conditions.push(`(t.source_org_id = $${params.length} OR t.target_org_id = $${params.length})`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await query(
      `
      SELECT t.*,
             src.name AS source_org_name, src.code AS source_org_code, src.lat AS source_lat, src.lng AS source_lng,
             tgt.name AS target_org_name, tgt.code AS target_org_code, tgt.lat AS target_lat, tgt.lng AS target_lng,
             approver.full_name AS approved_by_name,
             COALESCE(
               json_agg(
                 json_build_object(
                   'unit_id', bu.id,
                   'unit_code', bu.unit_code,
                   'expiry_date', bu.expiry_date,
                   'status', bu.status
                 )
               ) FILTER (WHERE bu.id IS NOT NULL),
               '[]'::json
             ) AS allocated_units
      FROM transfers t
      JOIN organizations src ON src.id = t.source_org_id
      JOIN organizations tgt ON tgt.id = t.target_org_id
      LEFT JOIN users approver ON approver.id = t.approved_by
      LEFT JOIN transfer_units tu ON tu.transfer_id = t.id
      LEFT JOIN blood_units bu ON bu.id = tu.unit_id
      ${where}
      GROUP BY t.id, src.id, tgt.id, approver.id
      ORDER BY t.created_at DESC
      LIMIT 200
      `,
      params
    );

    res.json({ transfers: rows });
  })
);

router.post(
  '/',
  authenticate,
  requireRoles('central_admin', 'hospital_staff', 'blood_bank_staff', 'regional_authority'),
  asyncHandler(async (req, res) => {
    const body = createTransferSchema.parse(req.body);
    if (body.source_org_id === body.target_org_id) {
      throw new AppError(400, 'Source and target organizations must differ', 'SAME_ORG');
    }

    if (body.unit_ids && body.unit_ids.length !== body.units_count) {
      throw new AppError(400, 'unit_ids length must match units_count', 'UNIT_COUNT_MISMATCH');
    }

    const created = await withTransaction(async (client) => {
      // Compute spatial distance & estimated road ETA via PostGIS
      const distRes = await client.query<{ distance_km: number; eta_minutes: number }>(
        `
        SELECT
          ROUND((ST_Distance(src.location, tgt.location) / 1000.0)::numeric, 2)::float AS distance_km,
          GREATEST(5, ROUND(((ST_Distance(src.location, tgt.location) / 1000.0) / 28.0) * 60)::int) AS eta_minutes
        FROM organizations src, organizations tgt
        WHERE src.id = $1 AND tgt.id = $2
        `,
        [body.source_org_id, body.target_org_id]
      );
      if (distRes.rows.length === 0) {
        throw new AppError(404, 'Source or target organization not found', 'ORG_NOT_FOUND');
      }
      const { distance_km, eta_minutes } = distRes.rows[0];

      // Lock exact units transactionally so two organizations can NEVER allocate the same unit
      let selectedUnits: { id: string; unit_code: string; status: string }[];
      if (body.unit_ids && body.unit_ids.length > 0) {
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
            AND expiry_date >= CURRENT_DATE
          FOR UPDATE
          `,
          [body.unit_ids, body.source_org_id, body.blood_group, body.component]
        );
        if (rows.length !== body.unit_ids.length) {
          throw new AppError(
            409,
            'One or more specified units are already reserved, unavailable, or cold-chain compromised',
            'UNITS_ALREADY_ALLOCATED'
          );
        }
        selectedUnits = rows;
      } else {
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
          [body.source_org_id, body.blood_group, body.component, body.units_count]
        );
        if (rows.length < body.units_count) {
          throw new AppError(
            409,
            `Insufficient unreserved stock at source organization: requested ${body.units_count}, available ${rows.length}`,
            'INSUFFICIENT_STOCK'
          );
        }
        selectedUnits = rows;
      }

      const transferCode = `TRF-RNC-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      // Safety rule: ALWAYS created as 'pending' — never auto-approved!
      const { rows: trRows } = await client.query(
        `
        INSERT INTO transfers (
          transfer_code, source_org_id, target_org_id, request_id,
          blood_group, component, units_count, approval_status,
          recommended_by_ai, ai_priority_rank, ai_objective_score, ai_rationale,
          distance_km, eta_minutes, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11::jsonb, $12, $13, $14)
        RETURNING *
        `,
        [
          transferCode,
          body.source_org_id,
          body.target_org_id,
          body.request_id ?? null,
          body.blood_group,
          body.component,
          selectedUnits.length,
          body.recommended_by_ai,
          body.ai_priority_rank ?? null,
          body.ai_objective_score ?? null,
          body.ai_rationale ? JSON.stringify(body.ai_rationale) : null,
          distance_km,
          eta_minutes,
          req.user!.id,
        ]
      );
      const transfer = trRows[0];

      for (const u of selectedUnits) {
        await client.query(
          `INSERT INTO transfer_units (transfer_id, unit_id, is_active) VALUES ($1, $2, TRUE)`,
          [transfer.id, u.id]
        );
        await client.query(
          `
          UPDATE blood_units
          SET status = 'reserved',
              is_reserved = TRUE,
              reserved_for_request_id = $2,
              version = version + 1
          WHERE id = $1
          `,
          [u.id, body.request_id ?? null]
        );
        await recordInventoryTransaction(
          {
            unitId: u.id,
            organizationId: body.source_org_id,
            transactionType: 'reserve',
            deltaUnits: 0,
            previousStatus: 'available',
            newStatus: 'reserved',
            performedBy: req.user!.id,
            referenceId: transfer.id,
            notes: `Reserved for pending transfer ${transferCode} (awaiting human approval)`,
          },
          client
        );
      }

      await client.query(
        `
        INSERT INTO notifications (
          organization_id, target_role, title, message, severity, category, metadata
        )
        VALUES ($1, 'blood_bank_staff', $2, $3, 'high', 'transfer', $4::jsonb)
        `,
        [
          body.source_org_id,
          `Transfer Approval Required: ${transferCode}`,
          `${selectedUnits.length}x ${body.blood_group} ${body.component} reserved for transfer (${distance_km} km). Human approval required.`,
          JSON.stringify({ transfer_id: transfer.id, transfer_code: transferCode }),
        ]
      );

      await recordAuditLog(
        {
          actorUserId: req.user!.id,
          actorRole: req.user!.role,
          organizationId: body.source_org_id,
          action: 'CREATE_TRANSFER_PROPOSAL',
          entityType: 'transfer',
          entityId: transfer.id,
          newValues: {
            transfer_code: transferCode,
            source_org_id: body.source_org_id,
            target_org_id: body.target_org_id,
            unit_ids: selectedUnits.map((u) => u.id),
            approval_status: 'pending',
          },
          ipAddress: req.ip,
        },
        client
      );

      return { ...transfer, allocated_units: selectedUnits };
    });

    res.status(201).json({ transfer: created });
  })
);

router.post(
  '/:id/approve',
  authenticate,
  requireRoles('central_admin', 'blood_bank_staff'),
  asyncHandler(async (req, res) => {
    const id = paramStr(req.params.id);

    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM transfers WHERE id = $1 FOR UPDATE', [id]);
      const transfer = rows[0];
      if (!transfer) throw new AppError(404, 'Transfer not found', 'NOT_FOUND');

      if (
        req.user!.role === 'blood_bank_staff' &&
        req.user!.organizationId !== transfer.source_org_id
      ) {
        throw new AppError(
          403,
          'Only source blood bank staff or central admin can approve this transfer',
          'FORBIDDEN'
        );
      }

      if (transfer.approval_status !== 'pending') {
        throw new AppError(
          400,
          `Cannot approve transfer in status '${transfer.approval_status}'`,
          'INVALID_STATUS'
        );
      }

      const { rows: upd } = await client.query(
        `
        UPDATE transfers
        SET approval_status = 'approved',
            approved_by = $2,
            approved_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        [id, req.user!.id]
      );

      await client.query(
        `
        INSERT INTO notifications (
          organization_id, target_role, title, message, severity, category, metadata
        )
        VALUES ($1, 'hospital_staff', $2, $3, 'info', 'transfer', $4::jsonb)
        `,
        [
          transfer.target_org_id,
          `Transfer Approved: ${transfer.transfer_code}`,
          `Source blood bank approved ${transfer.units_count}x ${transfer.blood_group} ${transfer.component}. Ready for dispatch.`,
          JSON.stringify({ transfer_id: transfer.id, transfer_code: transfer.transfer_code }),
        ]
      );

      await recordAuditLog(
        {
          actorUserId: req.user!.id,
          actorRole: req.user!.role,
          organizationId: transfer.source_org_id,
          action: 'APPROVE_TRANSFER',
          entityType: 'transfer',
          entityId: id,
          oldValues: { approval_status: 'pending' },
          newValues: { approval_status: 'approved', approved_by: req.user!.id },
          ipAddress: req.ip,
        },
        client
      );

      return upd[0];
    });

    res.json({ transfer: updated });
  })
);

router.post(
  '/:id/reject',
  authenticate,
  requireRoles('central_admin', 'blood_bank_staff'),
  asyncHandler(async (req, res) => {
    const id = paramStr(req.params.id);
    const body = rejectSchema.parse(req.body);

    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM transfers WHERE id = $1 FOR UPDATE', [id]);
      const transfer = rows[0];
      if (!transfer) throw new AppError(404, 'Transfer not found', 'NOT_FOUND');

      if (
        req.user!.role === 'blood_bank_staff' &&
        req.user!.organizationId !== transfer.source_org_id
      ) {
        throw new AppError(
          403,
          'Only source blood bank staff or central admin can reject this transfer',
          'FORBIDDEN'
        );
      }

      if (!['pending', 'approved'].includes(transfer.approval_status)) {
        throw new AppError(
          400,
          `Cannot reject transfer in status '${transfer.approval_status}'`,
          'INVALID_STATUS'
        );
      }

      // Release reserved units back to available pool
      const unitLinks = await client.query<{ unit_id: string }>(
        'SELECT unit_id FROM transfer_units WHERE transfer_id = $1 AND is_active = TRUE',
        [id]
      );

      for (const link of unitLinks.rows) {
        await client.query(
          `
          UPDATE blood_units
          SET status = 'available',
              is_reserved = FALSE,
              reserved_for_request_id = NULL,
              version = version + 1
          WHERE id = $1 AND cold_chain_ok = TRUE
          `,
          [link.unit_id]
        );
        await recordInventoryTransaction(
          {
            unitId: link.unit_id,
            organizationId: transfer.source_org_id,
            transactionType: 'release',
            deltaUnits: 0,
            previousStatus: 'reserved',
            newStatus: 'available',
            performedBy: req.user!.id,
            referenceId: id,
            notes: `Released due to transfer rejection: ${body.rejection_reason}`,
          },
          client
        );
      }

      await client.query(`UPDATE transfer_units SET is_active = FALSE WHERE transfer_id = $1`, [
        id,
      ]);

      const { rows: upd } = await client.query(
        `
        UPDATE transfers
        SET approval_status = 'rejected',
            rejection_reason = $2
        WHERE id = $1
        RETURNING *
        `,
        [id, body.rejection_reason]
      );

      await recordAuditLog(
        {
          actorUserId: req.user!.id,
          actorRole: req.user!.role,
          organizationId: transfer.source_org_id,
          action: 'REJECT_TRANSFER',
          entityType: 'transfer',
          entityId: id,
          oldValues: { approval_status: transfer.approval_status },
          newValues: { approval_status: 'rejected', rejection_reason: body.rejection_reason },
          ipAddress: req.ip,
        },
        client
      );

      return upd[0];
    });

    res.json({ transfer: updated });
  })
);

router.post(
  '/:id/dispatch',
  authenticate,
  requireRoles('central_admin', 'blood_bank_staff'),
  asyncHandler(async (req, res) => {
    const id = paramStr(req.params.id);

    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM transfers WHERE id = $1 FOR UPDATE', [id]);
      const transfer = rows[0];
      if (!transfer) throw new AppError(404, 'Transfer not found', 'NOT_FOUND');

      if (
        req.user!.role === 'blood_bank_staff' &&
        req.user!.organizationId !== transfer.source_org_id
      ) {
        throw new AppError(403, 'Forbidden', 'FORBIDDEN');
      }
      if (transfer.approval_status !== 'approved') {
        throw new AppError(
          400,
          'Transfer must be human-approved before dispatch',
          'APPROVAL_REQUIRED'
        );
      }

      const unitLinks = await client.query<{ unit_id: string }>(
        'SELECT unit_id FROM transfer_units WHERE transfer_id = $1 AND is_active = TRUE',
        [id]
      );
      for (const link of unitLinks.rows) {
        await client.query(
          `UPDATE blood_units SET status = 'in_transit', version = version + 1 WHERE id = $1`,
          [link.unit_id]
        );
        await recordInventoryTransaction(
          {
            unitId: link.unit_id,
            organizationId: transfer.source_org_id,
            transactionType: 'transfer_out',
            deltaUnits: -1,
            previousStatus: 'reserved',
            newStatus: 'in_transit',
            performedBy: req.user!.id,
            referenceId: id,
            notes: `Dispatched transfer ${transfer.transfer_code}`,
          },
          client
        );
      }

      const { rows: upd } = await client.query(
        `
        UPDATE transfers
        SET approval_status = 'in_transit',
            dispatched_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        [id]
      );

      await recordAuditLog(
        {
          actorUserId: req.user!.id,
          actorRole: req.user!.role,
          organizationId: transfer.source_org_id,
          action: 'DISPATCH_TRANSFER',
          entityType: 'transfer',
          entityId: id,
          oldValues: { approval_status: 'approved' },
          newValues: { approval_status: 'in_transit' },
          ipAddress: req.ip,
        },
        client
      );

      await evaluateShortageThreshold(
        transfer.source_org_id,
        transfer.blood_group,
        transfer.component,
        client
      );

      return upd[0];
    });

    res.json({ transfer: updated });
  })
);

router.post(
  '/:id/complete',
  authenticate,
  requireRoles('central_admin', 'hospital_staff', 'blood_bank_staff'),
  asyncHandler(async (req, res) => {
    const id = paramStr(req.params.id);

    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM transfers WHERE id = $1 FOR UPDATE', [id]);
      const transfer = rows[0];
      if (!transfer) throw new AppError(404, 'Transfer not found', 'NOT_FOUND');

      if (
        req.user!.role === 'hospital_staff' &&
        req.user!.organizationId !== transfer.target_org_id
      ) {
        throw new AppError(
          403,
          'Only receiving hospital staff or central admin can complete receipt',
          'FORBIDDEN'
        );
      }

      if (transfer.approval_status !== 'in_transit') {
        throw new AppError(
          400,
          `Transfer must be in_transit to complete (current: ${transfer.approval_status})`,
          'INVALID_STATUS'
        );
      }

      const unitLinks = await client.query<{ unit_id: string }>(
        'SELECT unit_id FROM transfer_units WHERE transfer_id = $1 AND is_active = TRUE',
        [id]
      );

      for (const link of unitLinks.rows) {
        await client.query(
          `
          UPDATE blood_units
          SET organization_id = $2,
              status = 'available',
              is_reserved = FALSE,
              reserved_for_request_id = NULL,
              version = version + 1
          WHERE id = $1 AND cold_chain_ok = TRUE
          `,
          [link.unit_id, transfer.target_org_id]
        );
        await recordInventoryTransaction(
          {
            unitId: link.unit_id,
            organizationId: transfer.target_org_id,
            transactionType: 'transfer_in',
            deltaUnits: 1,
            previousStatus: 'in_transit',
            newStatus: 'available',
            performedBy: req.user!.id,
            referenceId: id,
            notes: `Received from transfer ${transfer.transfer_code}`,
          },
          client
        );
      }

      await client.query(`UPDATE transfer_units SET is_active = FALSE WHERE transfer_id = $1`, [
        id,
      ]);

      const { rows: upd } = await client.query(
        `
        UPDATE transfers
        SET approval_status = 'completed',
            completed_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        [id]
      );

      if (transfer.request_id) {
        await client.query(
          `
          UPDATE blood_requests
          SET units_fulfilled = LEAST(units_requested, units_fulfilled + $2),
              status = CASE
                WHEN units_fulfilled + $2 >= units_requested THEN 'fulfilled'
                ELSE 'partially_fulfilled'
              END
          WHERE id = $1
          `,
          [transfer.request_id, unitLinks.rows.length]
        );
      }

      await recordAuditLog(
        {
          actorUserId: req.user!.id,
          actorRole: req.user!.role,
          organizationId: transfer.target_org_id,
          action: 'COMPLETE_TRANSFER',
          entityType: 'transfer',
          entityId: id,
          oldValues: { approval_status: 'in_transit' },
          newValues: { approval_status: 'completed', units_received: unitLinks.rows.length },
          ipAddress: req.ip,
        },
        client
      );

      await evaluateShortageThreshold(
        transfer.target_org_id,
        transfer.blood_group,
        transfer.component,
        client
      );

      return upd[0];
    });

    res.json({ transfer: updated });
  })
);

export default router;
