import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { UserRole } from '../utils/constants';
import { AppError } from './errorHandler';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  organizationId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signAuthToken(user: AuthUser): string {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] }
  );
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError(401, 'Authentication token required', 'UNAUTHORIZED');
  }

  const token = authHeader.slice(7).trim();
  try {
    const payload = jwt.verify(token, env.jwtSecret) as {
      sub: string;
      email: string;
      fullName: string;
      role: UserRole;
      organizationId: string | null;
    };
    req.user = {
      id: payload.sub,
      email: payload.email,
      fullName: payload.fullName,
      role: payload.role,
      organizationId: payload.organizationId,
    };
    next();
  } catch {
    throw new AppError(401, 'Invalid or expired authentication token', 'INVALID_TOKEN');
  }
}

export function requireRoles(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }
    if (!allowedRoles.includes(req.user.role)) {
      throw new AppError(
        403,
        `Forbidden: requires one of [${allowedRoles.join(', ')}]`,
        'FORBIDDEN'
      );
    }
    next();
  };
}

/**
 * Ensures hospital/blood_bank staff can only mutate resources belonging to their own organization,
 * while central_admin (and optionally regional_authority) have network-wide scope.
 */
export function resolveScopedOrgId(
  user: AuthUser,
  requestedOrgId?: string | null,
  allowRegionalRead = false
): string {
  if (user.role === 'central_admin' || (allowRegionalRead && user.role === 'regional_authority')) {
    if (!requestedOrgId) {
      throw new AppError(400, 'organization_id is required', 'ORG_REQUIRED');
    }
    return requestedOrgId;
  }

  if (!user.organizationId) {
    throw new AppError(403, 'User is not assigned to an organization', 'NO_ORG_ASSIGNED');
  }

  if (requestedOrgId && requestedOrgId !== user.organizationId) {
    throw new AppError(
      403,
      'Forbidden: cannot perform this action for another organization',
      'ORG_SCOPE_FORBIDDEN'
    );
  }

  return user.organizationId;
}
