-- BloodNet AI - Indexes, Spatial Triggers, and Transactional Inventory Sync

-- Partial unique index: a blood unit can only belong to ONE active transfer at any instant
CREATE UNIQUE INDEX IF NOT EXISTS uq_transfer_units_active_unit
    ON transfer_units (unit_id)
    WHERE is_active = TRUE;

-- Performance & spatial indexes
CREATE INDEX IF NOT EXISTS idx_organizations_location ON organizations USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_organizations_type ON organizations (type);

CREATE INDEX IF NOT EXISTS idx_blood_units_org_group_comp_status
    ON blood_units (organization_id, blood_group, component, status);
CREATE INDEX IF NOT EXISTS idx_blood_units_expiry_fefo
    ON blood_units (expiry_date ASC)
    WHERE status = 'available' AND is_reserved = FALSE AND cold_chain_ok = TRUE;

CREATE INDEX IF NOT EXISTS idx_blood_inventory_lookup
    ON blood_inventory (organization_id, blood_group, component);

CREATE INDEX IF NOT EXISTS idx_consumption_timeseries
    ON consumption (organization_id, blood_group, component, consumption_date);
CREATE INDEX IF NOT EXISTS idx_consumption_date
    ON consumption (consumption_date);

CREATE INDEX IF NOT EXISTS idx_blood_requests_status_org
    ON blood_requests (status, requesting_org_id, required_by);

CREATE INDEX IF NOT EXISTS idx_transfers_status_orgs
    ON transfers (approval_status, source_org_id, target_org_id);

CREATE INDEX IF NOT EXISTS idx_predictions_lookup
    ON predictions (organization_id, blood_group, component, target_date, horizon_days);

CREATE INDEX IF NOT EXISTS idx_shortage_alerts_active
    ON shortage_alerts (status, risk_level, organization_id);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
    ON notifications (organization_id, user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_unit_org
    ON inventory_transactions (organization_id, unit_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity_time
    ON audit_log (entity_type, entity_id, created_at DESC);

-- Function & trigger to keep PostGIS location synced from lat/lng
CREATE OR REPLACE FUNCTION sync_organization_location()
RETURNS TRIGGER AS $$
BEGIN
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_organizations_sync_location ON organizations;
CREATE TRIGGER trg_organizations_sync_location
    BEFORE INSERT OR UPDATE OF lat, lng ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION sync_organization_location();

-- Function to recompute a single (organization_id, blood_group, component) inventory summary row
CREATE OR REPLACE FUNCTION refresh_blood_inventory_bucket(
    p_org_id UUID,
    p_blood_group VARCHAR(4),
    p_component VARCHAR(20)
)
RETURNS VOID AS $$
DECLARE
    v_total INTEGER := 0;
    v_avail INTEGER := 0;
    v_res INTEGER := 0;
    v_transit INTEGER := 0;
    v_expiring INTEGER := 0;
    v_quar INTEGER := 0;
BEGIN
    SELECT
        COUNT(*) FILTER (WHERE status IN ('available', 'reserved', 'in_transit', 'quarantined')),
        COUNT(*) FILTER (WHERE status = 'available' AND is_reserved = FALSE AND cold_chain_ok = TRUE AND expiry_date >= CURRENT_DATE),
        COUNT(*) FILTER (WHERE status = 'reserved' OR (status = 'available' AND is_reserved = TRUE)),
        COUNT(*) FILTER (WHERE status = 'in_transit'),
        COUNT(*) FILTER (WHERE status IN ('available', 'reserved') AND expiry_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '7 days')),
        COUNT(*) FILTER (WHERE status = 'quarantined' OR cold_chain_ok = FALSE)
    INTO v_total, v_avail, v_res, v_transit, v_expiring, v_quar
    FROM blood_units
    WHERE organization_id = p_org_id
      AND blood_group = p_blood_group
      AND component = p_component;

    INSERT INTO blood_inventory (
        organization_id, blood_group, component,
        total_units, available_units, reserved_units,
        in_transit_units, expiring_within_7d_units, quarantined_units,
        last_updated_at
    )
    VALUES (
        p_org_id, p_blood_group, p_component,
        COALESCE(v_total, 0), COALESCE(v_avail, 0), COALESCE(v_res, 0),
        COALESCE(v_transit, 0), COALESCE(v_expiring, 0), COALESCE(v_quar, 0),
        NOW()
    )
    ON CONFLICT (organization_id, blood_group, component)
    DO UPDATE SET
        total_units = EXCLUDED.total_units,
        available_units = EXCLUDED.available_units,
        reserved_units = EXCLUDED.reserved_units,
        in_transit_units = EXCLUDED.in_transit_units,
        expiring_within_7d_units = EXCLUDED.expiring_within_7d_units,
        quarantined_units = EXCLUDED.quarantined_units,
        last_updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Trigger on blood_units to keep blood_inventory automatically synchronized
CREATE OR REPLACE FUNCTION trg_sync_blood_inventory_fn()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM refresh_blood_inventory_bucket(OLD.organization_id, OLD.blood_group, OLD.component);
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        IF (OLD.organization_id <> NEW.organization_id OR OLD.blood_group <> NEW.blood_group OR OLD.component <> NEW.component) THEN
            PERFORM refresh_blood_inventory_bucket(OLD.organization_id, OLD.blood_group, OLD.component);
        END IF;
        PERFORM refresh_blood_inventory_bucket(NEW.organization_id, NEW.blood_group, NEW.component);
        RETURN NEW;
    ELSE
        PERFORM refresh_blood_inventory_bucket(NEW.organization_id, NEW.blood_group, NEW.component);
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_blood_units_sync_inventory ON blood_units;
CREATE TRIGGER trg_blood_units_sync_inventory
    AFTER INSERT OR UPDATE OR DELETE ON blood_units
    FOR EACH ROW
    EXECUTE FUNCTION trg_sync_blood_inventory_fn();

-- Generic updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_blood_requests_updated_at ON blood_requests;
CREATE TRIGGER trg_blood_requests_updated_at BEFORE UPDATE ON blood_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_blood_units_updated_at ON blood_units;
CREATE TRIGGER trg_blood_units_updated_at BEFORE UPDATE ON blood_units FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_transfers_updated_at ON transfers;
CREATE TRIGGER trg_transfers_updated_at BEFORE UPDATE ON transfers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_shortage_alerts_updated_at ON shortage_alerts;
CREATE TRIGGER trg_shortage_alerts_updated_at BEFORE UPDATE ON shortage_alerts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
