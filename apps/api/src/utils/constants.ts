export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export const BLOOD_COMPONENTS = ['whole_blood', 'rbc', 'platelets', 'plasma'] as const;
export type BloodComponent = (typeof BLOOD_COMPONENTS)[number];

export const USER_ROLES = [
  'central_admin',
  'regional_authority',
  'hospital_staff',
  'blood_bank_staff',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const COMPONENT_META: Record<
  BloodComponent,
  { shelfLifeDays: number; defaultVolumeMl: number; shortCode: string }
> = {
  whole_blood: { shelfLifeDays: 35, defaultVolumeMl: 350, shortCode: 'WB' },
  rbc: { shelfLifeDays: 42, defaultVolumeMl: 300, shortCode: 'RBC' },
  platelets: { shelfLifeDays: 5, defaultVolumeMl: 70, shortCode: 'PLT' },
  plasma: { shelfLifeDays: 365, defaultVolumeMl: 220, shortCode: 'PLS' },
};

export function paramStr(val: string | string[] | undefined): string {
  return Array.isArray(val) ? val[0] : val ?? '';
}

// RBC compatible donor groups for a recipient blood group (for matching/recommendations)
export const RBC_COMPATIBLE_DONORS: Record<BloodGroup, BloodGroup[]> = {
  'O-': ['O-'],
  'O+': ['O+', 'O-'],
  'A-': ['A-', 'O-'],
  'A+': ['A+', 'A-', 'O+', 'O-'],
  'B-': ['B-', 'O-'],
  'B+': ['B+', 'B-', 'O+', 'O-'],
  'AB-': ['AB-', 'A-', 'B-', 'O-'],
  'AB+': ['AB+', 'AB-', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-'],
};

const FORBIDDEN_PII_KEYS = [
  'patient_name',
  'patientName',
  'patient_id',
  'patientId',
  'aadhaar',
  'ssn',
  'dob',
  'date_of_birth',
  'donor_name',
  'donorName',
  'donor_phone',
];

/**
 * Safety check ensuring zero patient-identifiable data is accepted anywhere in the API.
 */
export function containsForbiddenPii(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (FORBIDDEN_PII_KEYS.includes(k)) return k;
    if (v && typeof v === 'object') {
      const nested = containsForbiddenPii(v);
      if (nested) return nested;
    }
  }
  return null;
}
