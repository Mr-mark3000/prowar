import { Router } from 'express';
import { query } from '../db/pool';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

/**
 * Aggregated analytics endpoint for dashboards (avoids transferring raw 172k+ rows to browser).
 * Serves actual historical consumption, seasonal comparisons, inventory summaries,
 * and ML predictions (when populated by Phase 4 AI service, with baseline preview metadata).
 */
router.get(
  '/overview',
  authenticate,
  asyncHandler(async (req, res) => {
    const { organization_id, blood_group, component, horizon = '30' } = req.query;
    const horizonDays = Number(horizon) === 7 ? 7 : 30;

    const consConds: string[] = [];
    const consParams: unknown[] = [];

    if (organization_id && typeof organization_id === 'string' && organization_id !== 'all') {
      consParams.push(organization_id);
      consConds.push(`c.organization_id = $${consParams.length}`);
    }
    if (blood_group && typeof blood_group === 'string' && blood_group !== 'all') {
      consParams.push(blood_group);
      consConds.push(`c.blood_group = $${consParams.length}`);
    }
    if (component && typeof component === 'string' && component !== 'all') {
      consParams.push(component);
      consConds.push(`c.component = $${consParams.length}`);
    }

    const consWhere = consConds.length > 0 ? `WHERE ${consConds.join(' AND ')}` : '';

    // 1. Daily actual demand (last 60 days)
    const dailyPromise = query<{
      date: string;
      actual_units: number;
      emergency_units: number;
    }>(
      `
      SELECT c.consumption_date::text AS date,
             SUM(c.units_used)::int AS actual_units,
             SUM(c.emergency_units)::int AS emergency_units
      FROM consumption c
      ${consWhere ? `${consWhere} AND` : 'WHERE'} c.consumption_date >= (
        SELECT COALESCE(MAX(consumption_date), CURRENT_DATE) - INTERVAL '59 days' FROM consumption
      )
      GROUP BY c.consumption_date
      ORDER BY c.consumption_date ASC
      `,
      consParams
    );

    // 2. Group-wise demand totals (last 30 days)
    const byGroupPromise = query<{
      blood_group: string;
      units_30d: number;
      emergency_30d: number;
    }>(
      `
      SELECT c.blood_group,
             SUM(c.units_used)::int AS units_30d,
             SUM(c.emergency_units)::int AS emergency_30d
      FROM consumption c
      ${consWhere ? `${consWhere} AND` : 'WHERE'} c.consumption_date >= (
        SELECT COALESCE(MAX(consumption_date), CURRENT_DATE) - INTERVAL '29 days' FROM consumption
      )
      GROUP BY c.blood_group
      ORDER BY units_30d DESC
      `,
      consParams
    );

    // 3. Seasonal / Monthly comparison across full history
    const seasonalPromise = query<{
      month_key: string;
      month_label: string;
      rbc: number;
      platelets: number;
      plasma: number;
      whole_blood: number;
      total: number;
    }>(
      `
      SELECT TO_CHAR(c.consumption_date, 'YYYY-MM') AS month_key,
             TO_CHAR(c.consumption_date, 'Mon YY') AS month_label,
             SUM(c.units_used) FILTER (WHERE c.component = 'rbc')::int AS rbc,
             SUM(c.units_used) FILTER (WHERE c.component = 'platelets')::int AS platelets,
             SUM(c.units_used) FILTER (WHERE c.component = 'plasma')::int AS plasma,
             SUM(c.units_used) FILTER (WHERE c.component = 'whole_blood')::int AS whole_blood,
             SUM(c.units_used)::int AS total
      FROM consumption c
      ${consWhere}
      GROUP BY 1, 2
      ORDER BY 1 ASC
      `,
      consParams
    );

    // 4. Current inventory & wastage/quarantine breakdown
    const invConds: string[] = [];
    const invParams: unknown[] = [];
    if (organization_id && typeof organization_id === 'string' && organization_id !== 'all') {
      invParams.push(organization_id);
      invConds.push(`bi.organization_id = $${invParams.length}`);
    }
    if (blood_group && typeof blood_group === 'string' && blood_group !== 'all') {
      invParams.push(blood_group);
      invConds.push(`bi.blood_group = $${invParams.length}`);
    }
    if (component && typeof component === 'string' && component !== 'all') {
      invParams.push(component);
      invConds.push(`bi.component = $${invParams.length}`);
    }
    const invWhere = invConds.length > 0 ? `WHERE ${invConds.join(' AND ')}` : '';

    const inventoryGroupPromise = query<{
      blood_group: string;
      available_units: number;
      reserved_units: number;
      expiring_7d: number;
      quarantined_units: number;
      safety_stock_units: number;
    }>(
      `
      SELECT bi.blood_group,
             SUM(bi.available_units)::int AS available_units,
             SUM(bi.reserved_units)::int AS reserved_units,
             SUM(bi.expiring_within_7d_units)::int AS expiring_7d,
             SUM(bi.quarantined_units)::int AS quarantined_units,
             SUM(bi.safety_stock_units)::int AS safety_stock_units
      FROM blood_inventory bi
      ${invWhere}
      GROUP BY bi.blood_group
      ORDER BY bi.blood_group
      `,
      invParams
    );

    // 5. Existing ML predictions if generated
    const predConds: string[] = [`p.horizon_days = $1`];
    const predParams: unknown[] = [horizonDays];
    if (organization_id && typeof organization_id === 'string' && organization_id !== 'all') {
      predParams.push(organization_id);
      predConds.push(`p.organization_id = $${predParams.length}`);
    }
    if (blood_group && typeof blood_group === 'string' && blood_group !== 'all') {
      predParams.push(blood_group);
      predConds.push(`p.blood_group = $${predParams.length}`);
    }
    if (component && typeof component === 'string' && component !== 'all') {
      predParams.push(component);
      predConds.push(`p.component = $${predParams.length}`);
    }

    const predictionsPromise = query<{
      target_date: string;
      predicted_demand: number;
      lower_bound: number;
      upper_bound: number;
      model_name: string;
      data_quality_flag: string;
    }>(
      `
      SELECT p.target_date::text AS target_date,
             ROUND(SUM(p.predicted_demand)::numeric, 2)::float AS predicted_demand,
             ROUND(SUM(p.lower_bound)::numeric, 2)::float AS lower_bound,
             ROUND(SUM(p.upper_bound)::numeric, 2)::float AS upper_bound,
             MAX(p.model_name) AS model_name,
             MAX(p.data_quality_flag) AS data_quality_flag
      FROM predictions p
      WHERE ${predConds.join(' AND ')}
        AND p.prediction_date = (SELECT MAX(prediction_date) FROM predictions)
      GROUP BY p.target_date
      ORDER BY p.target_date ASC
      `,
      predParams
    );

    // 6. Active alerts summary
    const alertsPromise = query<{
      blood_group: string;
      risk_level: string;
      cnt: number;
    }>(
      `
      SELECT blood_group, risk_level, COUNT(*)::int AS cnt
      FROM shortage_alerts
      WHERE status = 'active'
      GROUP BY blood_group, risk_level
      `
    );

    const [daily, byGroup, seasonal, invByGroup, predictions, alertsSummary] = await Promise.all([
      dailyPromise,
      byGroupPromise,
      seasonalPromise,
      inventoryGroupPromise,
      predictionsPromise,
      alertsPromise,
    ]);

    // Build baseline statistical projection if ML predictions haven't run yet (Phase 4 replaces this)
    const hasMlPredictions = predictions.rows.length > 0;
    const recentRows = daily.rows.slice(-14);
    const avgDaily =
      recentRows.length > 0
        ? recentRows.reduce((s, r) => s + r.actual_units, 0) / recentRows.length
        : 10;

    const totalAvailable = invByGroup.rows.reduce((s, r) => s + r.available_units, 0);
    const totalExpiring7d = invByGroup.rows.reduce((s, r) => s + r.expiring_7d, 0);
    const totalSafety = invByGroup.rows.reduce((s, r) => s + r.safety_stock_units, 0);

    const forecastSeries = hasMlPredictions
      ? predictions.rows
      : Array.from({ length: horizonDays }, (_, i) => {
          const baseDate = daily.rows.length > 0
            ? new Date(`${daily.rows[daily.rows.length - 1].date}T00:00:00Z`)
            : new Date();
          baseDate.setUTCDate(baseDate.getUTCDate() + i + 1);
          const dow = baseDate.getUTCDay();
          const dowFactor = [0.8, 1.02, 1.08, 1.1, 1.06, 1.05, 0.89][dow];
          const pred = Number((avgDaily * dowFactor).toFixed(2));
          return {
            target_date: baseDate.toISOString().slice(0, 10),
            predicted_demand: pred,
            lower_bound: Number(Math.max(0, pred * 0.78).toFixed(2)),
            upper_bound: Number((pred * 1.24).toFixed(2)),
            model_name: 'seasonal_moving_avg_preview',
            data_quality_flag: 'good',
          };
        });

    // Compute 30-day expected inventory trajectory I(t+1) = I(t) - predicted_demand - estimated_expiry
    let runningInv = totalAvailable;
    const dailyExpiryBurn = totalExpiring7d / 7;
    const inventoryProjection = forecastSeries.map((pt, idx) => {
      const expBurn = idx < 7 ? dailyExpiryBurn : 0.4;
      runningInv = Math.max(0, Number((runningInv - pt.predicted_demand - expBurn).toFixed(1)));
      return {
        date: pt.target_date,
        projected_inventory: runningInv,
        safety_stock: totalSafety,
        predicted_demand: pt.predicted_demand,
      };
    });

    res.json({
      horizon_days: horizonDays,
      prediction_source: hasMlPredictions ? 'ml_service' : 'statistical_preview',
      data_quality_warning: hasMlPredictions
        ? null
        : 'Showing statistical moving-average preview until scheduled XGBoost ML forecast job executes (Phase 4).',
      daily_actual: daily.rows,
      forecast_series: forecastSeries,
      inventory_projection: inventoryProjection,
      demand_by_group: byGroup.rows,
      seasonal_monthly: seasonal.rows,
      inventory_by_group: invByGroup.rows,
      alerts_summary: alertsSummary.rows,
    });
  })
);

export default router;
