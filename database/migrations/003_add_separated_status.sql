-- Allow 'separated' terminal status on whole_blood units that were split into components
ALTER TABLE blood_units DROP CONSTRAINT IF EXISTS blood_units_status_check;
ALTER TABLE blood_units ADD CONSTRAINT blood_units_status_check
    CHECK (status IN ('available', 'reserved', 'in_transit', 'transfused', 'expired', 'discarded', 'quarantined', 'separated'));
