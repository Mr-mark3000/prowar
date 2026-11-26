import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool';
import { authenticate, requireRoles, signAuthToken } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { USER_ROLES } from '../utils/constants';
import { recordAuditLog } from '../utils/audit';
import { hashPassword, verifyPassword } from '../utils/crypto';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const registerUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(2).max(160),
  role: z.enum(USER_ROLES),
  organization_id: z.string().uuid().nullable().optional(),
});

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const { rows } = await query<{
      id: string;
      email: string;
      password_hash: string;
      full_name: string;
      role: (typeof USER_ROLES)[number];
      organization_id: string | null;
      is_active: boolean;
      org_name: string | null;
      org_type: string | null;
      org_code: string | null;
    }>(
      `
      SELECT u.id, u.email, u.password_hash, u.full_name, u.role, u.organization_id, u.is_active,
             o.name AS org_name, o.type AS org_type, o.code AS org_code
      FROM users u
      LEFT JOIN organizations o ON o.id = u.organization_id
      WHERE LOWER(u.email) = LOWER($1)
      `,
      [body.email]
    );

    const user = rows[0];
    if (!user || !user.is_active || !verifyPassword(body.password, user.password_hash)) {
      throw new AppError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
    }

    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    await recordAuditLog({
      actorUserId: user.id,
      actorRole: user.role,
      organizationId: user.organization_id,
      action: 'USER_LOGIN',
      entityType: 'user',
      entityId: user.id,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });

    const token = signAuthToken({
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      organizationId: user.organization_id,
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        organization_id: user.organization_id,
        organization_name: user.org_name,
        organization_type: user.org_type,
        organization_code: user.org_code,
      },
    });
  })
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `
      SELECT u.id, u.email, u.full_name, u.role, u.organization_id, u.last_login_at,
             o.name AS organization_name, o.type AS organization_type, o.code AS organization_code,
             o.lat, o.lng, o.district
      FROM users u
      LEFT JOIN organizations o ON o.id = u.organization_id
      WHERE u.id = $1
      `,
      [req.user!.id]
    );

    if (rows.length === 0) {
      throw new AppError(404, 'User not found', 'NOT_FOUND');
    }
    res.json({ user: rows[0] });
  })
);

router.post(
  '/register',
  authenticate,
  requireRoles('central_admin'),
  asyncHandler(async (req, res) => {
    const body = registerUserSchema.parse(req.body);
    if (
      (body.role === 'hospital_staff' || body.role === 'blood_bank_staff') &&
      !body.organization_id
    ) {
      throw new AppError(
        400,
        'organization_id is required for hospital_staff and blood_bank_staff',
        'ORG_REQUIRED'
      );
    }

    const passwordHash = hashPassword(body.password);
    const { rows } = await query(
      `
      INSERT INTO users (email, password_hash, full_name, role, organization_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, email, full_name, role, organization_id, is_active, created_at
      `,
      [body.email.toLowerCase(), passwordHash, body.full_name, body.role, body.organization_id ?? null]
    );

    await recordAuditLog({
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      organizationId: body.organization_id ?? null,
      action: 'CREATE_USER',
      entityType: 'user',
      entityId: rows[0].id,
      newValues: { email: rows[0].email, role: rows[0].role, organization_id: rows[0].organization_id },
      ipAddress: req.ip,
    });

    res.status(201).json({ user: rows[0] });
  })
);

export default router;
