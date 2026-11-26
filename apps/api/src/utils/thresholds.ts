import { PoolClient } from 'pg';
import { pool } from '../db/pool';

type QueryExecutor = Pick<PoolClient, 'query'>;

export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';

/**
 * Cheap rule-based threshold check run synchronously on inventory/consumption changes.
 * Avoids running ML inference on every single inventory mutation while still raising
 * immediate shortage alerts and notifications when stock crosses safety thresholds.
 */
export async function evaluateShortageThreshold(
  organizationId: string,
  bloodGroup: string,
  component: string,
  executor: QueryExecutor = pool
): Promise<{ riskLevel: RiskLevel; availableUnits: number; safetyStock: number } | null> {
  const { rows } = await executor.query<{
    available_units: number;
    safety_stock_units: number;
    org_name: string;
    org_type: string;
  }>(
    `
    SELECT bi.available_units, bi.safety_stock_units, o.name AS org_name, o.type AS org_type
    FROM blood_inventory bi
    JOIN organizations o ON o.id = bi.organization_id
    WHERE bi.organization_id = $1
      AND bi.blood_group = $2
      AND bi.component = $3
    `,
    [organizationId, bloodGroup, component]
  );

  if (rows.length === 0) return null;

  const { available_units, safety_stock_units, org_name, org_type } = rows[0];
  const safety = Math.max(1, safety_stock_units);
  const ratio = available_units / safety;

  let riskLevel: RiskLevel = 'Low';
  if (available_units === 0 || ratio <= 0.25) {
    riskLevel = 'Critical';
  } else if (ratio <= 0.5) {
    riskLevel = 'High';
  } else if (ratio < 1.0) {
    riskLevel = 'Medium';
  }

  // Only manage active alerts for hospitals or critical blood bank depletion
  if (riskLevel === 'Low') {
    await executor.query(
      `
      UPDATE shortage_alerts
      SET status = 'resolved', resolved_at = NOW()
      WHERE organization_id = $1
        AND blood_group = $2
        AND component = $3
        AND status IN ('active', 'acknowledged')
      `,
      [organizationId, bloodGroup, component]
    );
    return { riskLevel, availableUnits: available_units, safetyStock: safety };
  }

  // Only raise immediate threshold alerts for Medium/High/Critical on hospitals (or Critical on blood banks)
  if (org_type === 'blood_bank' && riskLevel !== 'Critical') {
    return { riskLevel, availableUnits: available_units, safetyStock: safety };
  }

  const explanation =
    available_units === 0
      ? `${bloodGroup} ${component} stock at ${org_name} is depleted (0 units available vs ${safety} safety stock).`
      : `${bloodGroup} ${component} stock at ${org_name} dropped to ${available_units} units (${Math.round(ratio * 100)}% of ${safety}-unit safety stock).`;

  const existing = await executor.query<{ id: string; risk_level: RiskLevel }>(
    `
    SELECT id, risk_level FROM shortage_alerts
    WHERE organization_id = $1
      AND blood_group = $2
      AND component = $3
      AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [organizationId, bloodGroup, component]
  );

  if (existing.rows.length > 0) {
    await executor.query(
      `
      UPDATE shortage_alerts
      SET risk_level = $2,
          current_stock = $3,
          safety_stock = $4,
          explanation = $5,
          drivers = $6::jsonb
      WHERE id = $1
      `,
      [
        existing.rows[0].id,
        riskLevel,
        available_units,
        safety,
        explanation,
        JSON.stringify({ source: 'rule_threshold', stock_ratio: Number(ratio.toFixed(2)) }),
      ]
    );
  } else {
    await executor.query(
      `
      INSERT INTO shortage_alerts (
        organization_id, blood_group, component, risk_level,
        current_stock, safety_stock, expected_shortage_date,
        explanation, drivers, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE + INTERVAL '2 days', $7, $8::jsonb, 'active')
      `,
      [
        organizationId,
        bloodGroup,
        component,
        riskLevel,
        available_units,
        safety,
        explanation,
        JSON.stringify({ source: 'rule_threshold', stock_ratio: Number(ratio.toFixed(2)) }),
      ]
    );

    if (riskLevel === 'High' || riskLevel === 'Critical') {
      await executor.query(
        `
        INSERT INTO notifications (
          organization_id, target_role, title, message, severity, category, metadata
        )
        VALUES ($1, 'central_admin', $2, $3, $4, 'shortage', $5::jsonb)
        `,
        [
          organizationId,
          `${riskLevel} Shortage Threshold Alert: ${bloodGroup} ${component}`,
          explanation,
          riskLevel === 'Critical' ? 'critical' : 'high',
          JSON.stringify({ blood_group: bloodGroup, component, available_units, safety_stock: safety }),
        ]
      );
    }
  }

  return { riskLevel, availableUnits: available_units, safetyStock: safety };
}
