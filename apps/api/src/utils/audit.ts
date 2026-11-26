import { PoolClient } from 'pg';
import { pool } from '../db/pool';

export interface AuditEntry {
  actorUserId?: string | null;
  actorRole?: string | null;
  organizationId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface InventoryTxEntry {
  unitId?: string | null;
  organizationId: string;
  transactionType:
    | 'collect'
    | 'separate'
    | 'reserve'
    | 'release'
    | 'transfer_out'
    | 'transfer_in'
    | 'consume'
    | 'expire'
    | 'quarantine'
    | 'discard';
  deltaUnits: number;
  previousStatus?: string | null;
  newStatus?: string | null;
  performedBy?: string | null;
  referenceId?: string | null;
  notes?: string | null;
}

type QueryExecutor = Pick<PoolClient, 'query'>;

export async function recordAuditLog(
  entry: AuditEntry,
  executor: QueryExecutor = pool
): Promise<void> {
  await executor.query(
    `
    INSERT INTO audit_log (
      actor_user_id, actor_role, organization_id, action,
      entity_type, entity_id, old_values, new_values, ip_address, user_agent
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
    `,
    [
      entry.actorUserId ?? null,
      entry.actorRole ?? null,
      entry.organizationId ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.oldValues ? JSON.stringify(entry.oldValues) : null,
      entry.newValues ? JSON.stringify(entry.newValues) : null,
      entry.ipAddress ?? null,
      entry.userAgent ?? null,
    ]
  );
}

export async function recordInventoryTransaction(
  entry: InventoryTxEntry,
  executor: QueryExecutor = pool
): Promise<void> {
  await executor.query(
    `
    INSERT INTO inventory_transactions (
      unit_id, organization_id, transaction_type, delta_units,
      previous_status, new_status, performed_by, reference_id, notes
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      entry.unitId ?? null,
      entry.organizationId,
      entry.transactionType,
      entry.deltaUnits,
      entry.previousStatus ?? null,
      entry.newStatus ?? null,
      entry.performedBy ?? null,
      entry.referenceId ?? null,
      entry.notes ?? null,
    ]
  );
}
