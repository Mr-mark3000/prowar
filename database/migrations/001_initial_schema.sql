-- BloodNet AI - Initial PostgreSQL + PostGIS Schema
-- Decision-support system for predictive blood supply & shortage management (No PII stored)

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

-- Track applied migrations
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1. Organizations (hospitals, blood banks, collection centers)
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    type VARCHAR(32) NOT NULL CHECK (type IN ('hospital', 'blood_bank', 'collection_center')),
    district VARCHAR(100) NOT NULL DEFAULT 'Ranchi',
    state VARCHAR(100) NOT NULL DEFAULT 'Jharkhand',
    address TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
    location GEOGRAPHY(POINT, 4326),
    contact_phone VARCHAR(32),
    contact_email VARCHAR(160),
    storage_capacity_units INTEGER NOT NULL DEFAULT 250 CHECK (storage_capacity_units > 0),
    safety_stock_days INTEGER NOT NULL DEFAULT 5 CHECK (safety_stock_days BETWEEN 1 AND 30),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Users (RBAC; zero patient data)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(200) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(160) NOT NULL,
    role VARCHAR(32) NOT NULL CHECK (role IN ('central_admin', 'hospital_staff', 'blood_bank_staff', 'regional_authority')),
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Blood Requests (inter-organization supply requests)
CREATE TABLE IF NOT EXISTS blood_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_code VARCHAR(40) NOT NULL UNIQUE,
    requesting_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    blood_group VARCHAR(4) NOT NULL CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    component VARCHAR(20) NOT NULL CHECK (component IN ('whole_blood', 'rbc', 'platelets', 'plasma')),
    units_requested INTEGER NOT NULL CHECK (units_requested > 0),
    units_fulfilled INTEGER NOT NULL DEFAULT 0 CHECK (units_fulfilled >= 0),
    urgency VARCHAR(16) NOT NULL DEFAULT 'routine' CHECK (urgency IN ('routine', 'urgent', 'emergency')),
    status VARCHAR(24) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partially_fulfilled', 'fulfilled', 'cancelled')),
    required_by TIMESTAMPTZ NOT NULL,
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Individual Blood Units (unit-level & component-level tracking with cold-chain guard)
CREATE TABLE IF NOT EXISTS blood_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_code VARCHAR(48) NOT NULL UNIQUE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    source_unit_id UUID REFERENCES blood_units(id) ON DELETE SET NULL,
    blood_group VARCHAR(4) NOT NULL CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    component VARCHAR(20) NOT NULL CHECK (component IN ('whole_blood', 'rbc', 'platelets', 'plasma')),
    volume_ml INTEGER NOT NULL DEFAULT 350 CHECK (volume_ml > 0),
    collection_date DATE NOT NULL,
    expiry_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'reserved', 'in_transit', 'transfused', 'expired', 'discarded', 'quarantined')),
    is_reserved BOOLEAN NOT NULL DEFAULT FALSE,
    reserved_for_request_id UUID REFERENCES blood_requests(id) ON DELETE SET NULL,
    cold_chain_ok BOOLEAN NOT NULL DEFAULT TRUE,
    cold_chain_notes TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_unit_dates CHECK (expiry_date >= collection_date),
    -- Safety rule: cold-chain-failed units can never be marked available or reserved
    CONSTRAINT chk_cold_chain_safety CHECK (
        cold_chain_ok = TRUE OR status NOT IN ('available', 'reserved', 'in_transit')
    ),
    -- Consistency between status and is_reserved
    CONSTRAINT chk_reserved_consistency CHECK (
        (status = 'reserved' AND is_reserved = TRUE) OR (status <> 'reserved')
    )
);

-- 5. Blood Inventory Summary (transactionally maintained aggregate per org + blood_group + component)
CREATE TABLE IF NOT EXISTS blood_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    blood_group VARCHAR(4) NOT NULL CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    component VARCHAR(20) NOT NULL CHECK (component IN ('whole_blood', 'rbc', 'platelets', 'plasma')),
    total_units INTEGER NOT NULL DEFAULT 0 CHECK (total_units >= 0),
    available_units INTEGER NOT NULL DEFAULT 0 CHECK (available_units >= 0),
    reserved_units INTEGER NOT NULL DEFAULT 0 CHECK (reserved_units >= 0),
    in_transit_units INTEGER NOT NULL DEFAULT 0 CHECK (in_transit_units >= 0),
    expiring_within_7d_units INTEGER NOT NULL DEFAULT 0 CHECK (expiring_within_7d_units >= 0),
    quarantined_units INTEGER NOT NULL DEFAULT 0 CHECK (quarantined_units >= 0),
    safety_stock_units INTEGER NOT NULL DEFAULT 10 CHECK (safety_stock_units >= 0),
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, blood_group, component)
);

-- 6. Consumption History (aggregate daily & event-level consumption; zero patient data)
CREATE TABLE IF NOT EXISTS consumption (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    blood_group VARCHAR(4) NOT NULL CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    component VARCHAR(20) NOT NULL CHECK (component IN ('whole_blood', 'rbc', 'platelets', 'plasma')),
    consumption_date DATE NOT NULL,
    units_used INTEGER NOT NULL CHECK (units_used >= 0),
    emergency_units INTEGER NOT NULL DEFAULT 0 CHECK (emergency_units >= 0 AND emergency_units <= units_used),
    emergency_flag BOOLEAN NOT NULL DEFAULT FALSE,
    unit_id UUID REFERENCES blood_units(id) ON DELETE SET NULL,
    recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    source VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'synthetic', 'system')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Transfers (human-in-the-loop approval required; never auto-approved)
CREATE TABLE IF NOT EXISTS transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_code VARCHAR(40) NOT NULL UNIQUE,
    source_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    target_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    request_id UUID REFERENCES blood_requests(id) ON DELETE SET NULL,
    blood_group VARCHAR(4) NOT NULL CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    component VARCHAR(20) NOT NULL CHECK (component IN ('whole_blood', 'rbc', 'platelets', 'plasma')),
    units_count INTEGER NOT NULL CHECK (units_count > 0),
    approval_status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (approval_status IN ('pending', 'approved', 'rejected', 'in_transit', 'completed', 'cancelled')),
    recommended_by_ai BOOLEAN NOT NULL DEFAULT FALSE,
    ai_priority_rank INTEGER,
    ai_objective_score DOUBLE PRECISION,
    ai_rationale JSONB,
    distance_km DOUBLE PRECISION,
    eta_minutes INTEGER,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    dispatched_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_different_orgs CHECK (source_org_id <> target_org_id),
    CONSTRAINT chk_human_approval_required CHECK (
        approval_status NOT IN ('approved', 'in_transit', 'completed') OR approved_by IS NOT NULL
    )
);

-- 8. Transfer Units Join Table (enforces exclusive unit allocation across concurrent transfers)
CREATE TABLE IF NOT EXISTS transfer_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL REFERENCES blood_units(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (transfer_id, unit_id)
);

-- 9. AI Demand Predictions (ML forecasts, never LLM; daily granularity + confidence intervals)
CREATE TABLE IF NOT EXISTS predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prediction_run_id UUID NOT NULL,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    blood_group VARCHAR(4) NOT NULL CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    component VARCHAR(20) NOT NULL CHECK (component IN ('whole_blood', 'rbc', 'platelets', 'plasma')),
    prediction_date DATE NOT NULL,
    target_date DATE NOT NULL,
    horizon_days INTEGER NOT NULL CHECK (horizon_days IN (7, 30)),
    predicted_demand DOUBLE PRECISION NOT NULL CHECK (predicted_demand >= 0),
    lower_bound DOUBLE PRECISION NOT NULL CHECK (lower_bound >= 0),
    upper_bound DOUBLE PRECISION NOT NULL CHECK (upper_bound >= lower_bound),
    confidence_level DOUBLE PRECISION NOT NULL DEFAULT 0.95,
    model_name VARCHAR(64) NOT NULL,
    model_version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    data_quality_flag VARCHAR(24) NOT NULL DEFAULT 'good'
        CHECK (data_quality_flag IN ('good', 'sparse', 'imputed', 'spike_detected')),
    data_quality_notes TEXT,
    feature_importance JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Shortage Alerts (explainable risk classifications)
CREATE TABLE IF NOT EXISTS shortage_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    blood_group VARCHAR(4) NOT NULL CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    component VARCHAR(20) NOT NULL CHECK (component IN ('whole_blood', 'rbc', 'platelets', 'plasma')),
    risk_level VARCHAR(16) NOT NULL CHECK (risk_level IN ('Low', 'Medium', 'High', 'Critical')),
    current_stock INTEGER NOT NULL,
    safety_stock INTEGER NOT NULL,
    projected_stock_7d DOUBLE PRECISION,
    projected_stock_30d DOUBLE PRECISION,
    expected_shortage_date DATE,
    confidence_lower DOUBLE PRECISION,
    confidence_upper DOUBLE PRECISION,
    explanation TEXT NOT NULL,
    drivers JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved')),
    acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Notifications (real-time & persistent notifications)
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    target_role VARCHAR(32),
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    severity VARCHAR(16) NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'high', 'critical')),
    category VARCHAR(24) NOT NULL DEFAULT 'system' CHECK (category IN ('shortage', 'expiry', 'transfer', 'emergency', 'system')),
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Inventory Transactions (immutable ledger of unit state changes)
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID REFERENCES blood_units(id) ON DELETE SET NULL,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    transaction_type VARCHAR(24) NOT NULL CHECK (
        transaction_type IN ('collect', 'separate', 'reserve', 'release', 'transfer_out', 'transfer_in', 'consume', 'expire', 'quarantine', 'discard')
    ),
    delta_units INTEGER NOT NULL,
    previous_status VARCHAR(20),
    new_status VARCHAR(20),
    performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reference_id UUID,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. Audit Log (immutable compliance log for every inventory & transfer action)
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_role VARCHAR(32),
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    action VARCHAR(80) NOT NULL,
    entity_type VARCHAR(48) NOT NULL,
    entity_id VARCHAR(64),
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(64),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
