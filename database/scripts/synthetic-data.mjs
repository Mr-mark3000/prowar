import crypto from 'node:crypto';

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export const COMPONENTS = {
  whole_blood: { shelfLifeDays: 35, volumeMl: 350, shareOfDemand: 0.15 },
  rbc: { shelfLifeDays: 42, volumeMl: 300, shareOfDemand: 0.48 },
  platelets: { shelfLifeDays: 5, volumeMl: 70, shareOfDemand: 0.22 },
  plasma: { shelfLifeDays: 365, volumeMl: 220, shareOfDemand: 0.15 },
};

// Realistic blood group prevalence in Jharkhand / Eastern India
export const BLOOD_GROUP_WEIGHTS = {
  'B+': 0.32,
  'O+': 0.30,
  'A+': 0.22,
  'AB+': 0.08,
  'O-': 0.03,
  'B-': 0.025,
  'A-': 0.015,
  'AB-': 0.01,
};

// 10 Simulated Hospitals + 5 Simulated Blood Banks in Ranchi, Jharkhand
export const RANCHI_ORGANIZATIONS = [
  // 10 Hospitals
  {
    code: 'HOSP-RIMS',
    name: 'Rajendra Institute of Medical Sciences (RIMS)',
    type: 'hospital',
    district: 'Ranchi',
    address: 'Bariatu Road, Bariatu, Ranchi, Jharkhand 834009',
    lat: 23.3905,
    lng: 85.349,
    contact_phone: '+91-651-2541533',
    contact_email: 'blooddesk@rims-ranchi.pilot',
    storage_capacity_units: 600,
    safety_stock_days: 5,
    dailyBaseDemand: 28,
  },
  {
    code: 'HOSP-MEDICA',
    name: 'Bhagwan Mahavir Medica Superspecialty Hospital',
    type: 'hospital',
    district: 'Ranchi',
    address: 'Panchsheel Nagar, Bariatu Road, Ranchi, Jharkhand 834009',
    lat: 23.3921,
    lng: 85.3635,
    contact_phone: '+91-651-6606000',
    contact_email: 'transfusion@medica-ranchi.pilot',
    storage_capacity_units: 350,
    safety_stock_days: 5,
    dailyBaseDemand: 18,
  },
  {
    code: 'HOSP-RAJ',
    name: 'Raj Hospital & Research Centre',
    type: 'hospital',
    district: 'Ranchi',
    address: 'Mahatma Gandhi Main Road, Kadru, Ranchi, Jharkhand 834001',
    lat: 23.3563,
    lng: 85.3248,
    contact_phone: '+91-651-2331122',
    contact_email: 'icu-blood@rajhospital-ranchi.pilot',
    storage_capacity_units: 260,
    safety_stock_days: 5,
    dailyBaseDemand: 14,
  },
  {
    code: 'HOSP-ORCHID',
    name: 'Orchid Medical Centre',
    type: 'hospital',
    district: 'Ranchi',
    address: 'H.B. Road, Circular Road, Lalpur, Ranchi, Jharkhand 834001',
    lat: 23.3772,
    lng: 85.3318,
    contact_phone: '+91-651-7100100',
    contact_email: 'bloodunit@orchid-ranchi.pilot',
    storage_capacity_units: 240,
    safety_stock_days: 5,
    dailyBaseDemand: 12,
  },
  {
    code: 'HOSP-SADAR',
    name: 'Sadar Hospital Ranchi',
    type: 'hospital',
    district: 'Ranchi',
    address: 'Purulia Road, Tharpakhna, Ranchi, Jharkhand 834001',
    lat: 23.3688,
    lng: 85.3304,
    contact_phone: '+91-651-2201440',
    contact_email: 'supply@sadarhospital-ranchi.pilot',
    storage_capacity_units: 320,
    safety_stock_days: 6,
    dailyBaseDemand: 16,
  },
  {
    code: 'HOSP-GURU',
    name: 'Guru Nanak Hospital & Research Centre',
    type: 'hospital',
    district: 'Ranchi',
    address: 'Station Road, Siromtoli, Ranchi, Jharkhand 834001',
    lat: 23.3526,
    lng: 85.3338,
    contact_phone: '+91-651-2460321',
    contact_email: 'lab@gurunanak-ranchi.pilot',
    storage_capacity_units: 220,
    safety_stock_days: 5,
    dailyBaseDemand: 11,
  },
  {
    code: 'HOSP-CCL',
    name: 'CCL Central Hospital Gandhinagar',
    type: 'hospital',
    district: 'Ranchi',
    address: 'Kanke Road, Gandhinagar, Ranchi, Jharkhand 834008',
    lat: 23.4046,
    lng: 85.3212,
    contact_phone: '+91-651-2360119',
    contact_email: 'bloodward@cclhospital-ranchi.pilot',
    storage_capacity_units: 250,
    safety_stock_days: 5,
    dailyBaseDemand: 10,
  },
  {
    code: 'HOSP-HEC',
    name: 'HEC Plant Hospital Dhurwa',
    type: 'hospital',
    district: 'Ranchi',
    address: 'Sector 2, Dhurwa, Ranchi, Jharkhand 834004',
    lat: 23.2974,
    lng: 85.2768,
    contact_phone: '+91-651-2408120',
    contact_email: 'store@hechospital-ranchi.pilot',
    storage_capacity_units: 200,
    safety_stock_days: 5,
    dailyBaseDemand: 9,
  },
  {
    code: 'HOSP-SANTEVITA',
    name: 'Santevita Hospital',
    type: 'hospital',
    district: 'Ranchi',
    address: 'Hazaribagh Road, Near Lalpur Chowk, Ranchi, Jharkhand 834001',
    lat: 23.3709,
    lng: 85.3396,
    contact_phone: '+91-651-2562000',
    contact_email: 'transfusion@santevita-ranchi.pilot',
    storage_capacity_units: 230,
    safety_stock_days: 5,
    dailyBaseDemand: 12,
  },
  {
    code: 'HOSP-IRBA',
    name: 'Medanta Abdur Razzaque Ansari Memorial Hospital',
    type: 'hospital',
    district: 'Ranchi',
    address: 'NH-33, Irba, Ormanjhi, Ranchi, Jharkhand 835217',
    lat: 23.4375,
    lng: 85.4422,
    contact_phone: '+91-651-7123100',
    contact_email: 'bloodbank-desk@medanta-irba.pilot',
    storage_capacity_units: 340,
    safety_stock_days: 5,
    dailyBaseDemand: 15,
  },

  // 5 Blood Banks
  {
    code: 'BB-RIMS',
    name: 'RIMS Regional Model Blood Bank',
    type: 'blood_bank',
    district: 'Ranchi',
    address: 'Blood Centre Block, RIMS Campus, Bariatu, Ranchi 834009',
    lat: 23.3911,
    lng: 85.3484,
    contact_phone: '+91-651-2541800',
    contact_email: 'dispatch@rims-bloodbank.pilot',
    storage_capacity_units: 1200,
    safety_stock_days: 7,
    dailyBaseDemand: 0,
  },
  {
    code: 'BB-REDCROSS',
    name: 'Indian Red Cross Society Blood Bank Ranchi',
    type: 'blood_bank',
    district: 'Ranchi',
    address: 'Red Cross Bhawan, Near Morabadi / Main Road, Ranchi 834001',
    lat: 23.3665,
    lng: 85.3256,
    contact_phone: '+91-651-2204200',
    contact_email: 'dispatch@redcross-ranchi.pilot',
    storage_capacity_units: 950,
    safety_stock_days: 7,
    dailyBaseDemand: 0,
  },
  {
    code: 'BB-SADAR',
    name: 'Sadar District Blood Bank & Component Unit',
    type: 'blood_bank',
    district: 'Ranchi',
    address: 'District Hospital Campus, Purulia Road, Ranchi 834001',
    lat: 23.3692,
    lng: 85.331,
    contact_phone: '+91-651-2201499',
    contact_email: 'dispatch@sadar-bloodbank.pilot',
    storage_capacity_units: 800,
    safety_stock_days: 7,
    dailyBaseDemand: 0,
  },
  {
    code: 'BB-LIFESAVERS',
    name: 'Life Savers Voluntary Blood Bank',
    type: 'blood_bank',
    district: 'Ranchi',
    address: 'Harmu Housing Colony, Sahjanand Chowk, Ranchi 834002',
    lat: 23.3569,
    lng: 85.3025,
    contact_phone: '+91-651-2240555',
    contact_email: 'dispatch@lifesavers-ranchi.pilot',
    storage_capacity_units: 750,
    safety_stock_days: 6,
    dailyBaseDemand: 0,
  },
  {
    code: 'BB-KANKE',
    name: 'Ranchi Blood Bank & Component Centre',
    type: 'blood_bank',
    district: 'Ranchi',
    address: 'Kanke Road, Near CMPDI Colony, Ranchi 834008',
    lat: 23.3978,
    lng: 85.3175,
    contact_phone: '+91-651-2231777',
    contact_email: 'dispatch@ranchicc-bloodbank.pilot',
    storage_capacity_units: 700,
    safety_stock_days: 6,
    dailyBaseDemand: 0,
  },
];

// Deterministic PRNG (Mulberry32) so synthetic data is 100% reproducible
export function createRng(seed = 20261126) {
  let state = seed >>> 0;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function poissonSample(lambda, rng) {
  if (lambda <= 0) return 0;
  if (lambda > 30) {
    // Normal approximation for larger lambda
    const u1 = Math.max(1e-9, rng());
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
  }
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

// Jharkhand regional festivals / seasonal calendar effects
function getSeasonalAndFestivalMultiplier(date, component) {
  const month = date.getUTCMonth() + 1; // 1..12
  const day = date.getUTCDate();
  const dow = date.getUTCDay(); // 0=Sun..6=Sat

  let mult = 1.0;

  // Weekday pattern: Tue-Fri slightly higher scheduled surgery load; Sun lower elective
  const dowWeights = [0.78, 1.04, 1.1, 1.12, 1.08, 1.06, 0.88];
  mult *= dowWeights[dow];

  // Monsoon/post-monsoon dengue & malaria platelet surge (Aug - Nov)
  if (month >= 8 && month <= 11) {
    if (component === 'platelets') mult *= 1.55;
    else if (component === 'rbc') mult *= 1.12;
  }

  // Peak summer road trauma & anemia season (May - Jun)
  if (month === 5 || month === 6) {
    if (component === 'rbc' || component === 'whole_blood') mult *= 1.18;
  }

  // Winter elective surgeries (Dec - Feb)
  if (month === 12 || month === 1 || month === 2) {
    if (component === 'plasma') mult *= 1.1;
  }

  // Festival / holiday windows in Jharkhand (Sarhul Apr 1-3, Karma Sep 14-16,
  // Durga Puja Oct 10-15, Diwali/Chhath Oct 28 - Nov 8, Holi Mar 13-15)
  const isFestivalWindow =
    (month === 3 && day >= 13 && day <= 15) ||
    (month === 4 && day >= 1 && day <= 3) ||
    (month === 9 && day >= 14 && day <= 16) ||
    (month === 10 && day >= 10 && day <= 15) ||
    (month === 10 && day >= 28) ||
    (month === 11 && day <= 8);

  if (isFestivalWindow) {
    // Lower routine donor turnout + higher trauma / burn admissions
    mult *= 1.24;
  }

  return { mult, isFestivalWindow };
}

/**
 * Generates 540 days (18 months) of synthetic daily consumption records
 * for all 10 Ranchi hospitals across all 8 blood groups and 4 components.
 */
export function generateHistoricalConsumption(orgRows, referenceDate = new Date(), daysHistory = 540) {
  const rng = createRng(20260401);
  const hospitals = orgRows.filter((o) => o.type === 'hospital');
  const orgDemandMap = new Map(
    RANCHI_ORGANIZATIONS.map((o) => [o.code, o.dailyBaseDemand])
  );

  // Align to UTC midnight yesterday
  const endDate = new Date(Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate() - 1
  ));

  const records = [];
  for (let offset = daysHistory - 1; offset >= 0; offset--) {
    const dayDate = addDays(endDate, -offset);
    const dateStr = formatDate(dayDate);

    // Slight upward regional demand trend (+8% over 18 months)
    const trendFactor = 1 + ((daysHistory - offset) / daysHistory) * 0.08;

    for (const hosp of hospitals) {
      const baseDaily = orgDemandMap.get(hosp.code) || 12;

      for (const [component, compMeta] of Object.entries(COMPONENTS)) {
        const { mult, isFestivalWindow } = getSeasonalAndFestivalMultiplier(dayDate, component);

        for (const bg of BLOOD_GROUPS) {
          const bgWeight = BLOOD_GROUP_WEIGHTS[bg];

          // Random emergency spike (~1.8% probability per day/group/component)
          const isEmergencySpike = rng() < 0.018;
          const spikeMult = isEmergencySpike ? 2.2 + rng() * 1.8 : 1.0;

          const lambda =
            baseDaily *
            compMeta.shareOfDemand *
            bgWeight *
            mult *
            trendFactor *
            spikeMult;

          const unitsUsed = poissonSample(lambda, rng);
          const emergencyUnits = isEmergencySpike && unitsUsed > 0
            ? Math.max(1, Math.min(unitsUsed, Math.round(unitsUsed * (0.4 + rng() * 0.4))))
            : unitsUsed > 0 && isFestivalWindow && rng() < 0.25
              ? 1
              : 0;

          records.push({
            organization_id: hosp.id,
            blood_group: bg,
            component,
            consumption_date: dateStr,
            units_used: unitsUsed,
            emergency_units: emergencyUnits,
            emergency_flag: emergencyUnits > 0 || isEmergencySpike,
            source: 'synthetic',
          });
        }
      }
    }
  }

  return records;
}

/**
 * Generates realistic individual blood units for all 15 organizations.
 * Sets up realistic demo dynamics:
 * - Blood banks hold substantial surplus stock (especially O-, O+, B+, A+)
 * - HOSP-RAJ has low/critical O- RBC & B+ Platelets for live demo scenario
 * - Includes expiring units (1-3 days), reserved units, and a few cold-chain quarantined units
 */
export function generateBloodUnits(orgRows, referenceDate = new Date()) {
  const rng = createRng(20261126);
  const today = new Date(Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate()
  ));

  const units = [];
  let seq = 100001;

  for (const org of orgRows) {
    const isBloodBank = org.type === 'blood_bank';
    // Target total active stock per organization
    const orgMultiplier = isBloodBank
      ? org.code === 'BB-RIMS'
        ? 360
        : org.code === 'BB-REDCROSS'
          ? 280
          : 210
      : org.code === 'HOSP-RIMS'
        ? 180
        : org.code === 'HOSP-RAJ'
          ? 65
          : 95;

    for (const [component, compMeta] of Object.entries(COMPONENTS)) {
      const compShare =
        component === 'rbc'
          ? 0.48
          : component === 'plasma'
            ? 0.24
            : component === 'whole_blood'
              ? 0.16
              : 0.12;

      for (const bg of BLOOD_GROUPS) {
        let count = Math.round(orgMultiplier * compShare * BLOOD_GROUP_WEIGHTS[bg]);

        // Ensure blood banks hold healthy buffer of rare groups too
        if (isBloodBank && count < 4) count = 4;
        if (!isBloodBank && count < 1) count = rng() < 0.6 ? 1 : 0;

        // Demo pilot scenario: HOSP-RAJ is deliberately short on O- RBC and B+ platelets
        if (org.code === 'HOSP-RAJ' && bg === 'O-' && component === 'rbc') {
          count = 1;
        }
        if (org.code === 'HOSP-RAJ' && bg === 'B+' && component === 'platelets') {
          count = 1;
        }
        if (org.code === 'HOSP-SADAR' && bg === 'O-' && component === 'rbc') {
          count = 1;
        }
        // Ensure nearby blood banks have surplus O- RBC and B+ platelets
        if (org.code === 'BB-REDCROSS' && bg === 'O-' && component === 'rbc') {
          count = 12;
        }
        if (org.code === 'BB-RIMS' && bg === 'O-' && component === 'rbc') {
          count = 14;
        }
        if (org.code === 'BB-LIFESAVERS' && bg === 'B+' && component === 'platelets') {
          count = 16;
        }

        for (let i = 0; i < count; i++) {
          const shelfLife = compMeta.shelfLifeDays;
          // Collection age between 0 and (shelfLife - 1) days; skew slightly fresher
          const maxAge = Math.max(1, shelfLife - 1);
          let ageDays = Math.floor(Math.pow(rng(), 1.35) * maxAge);
          // Inject ~8% near-expiry units (1-3 days remaining) for FEFO demo
          if (rng() < 0.08 && shelfLife >= 5) {
            ageDays = Math.max(0, shelfLife - (1 + Math.floor(rng() * 3)));
          }

          const collectionDate = addDays(today, -ageDays);
          const expiryDate = addDays(collectionDate, shelfLife);

          // ~2% cold-chain compromised units -> MUST stay quarantined
          const coldChainFailed = rng() < 0.02;
          const isReserved = !coldChainFailed && rng() < 0.07;

          const status = coldChainFailed
            ? 'quarantined'
            : isReserved
              ? 'reserved'
              : 'available';

          units.push({
            unit_code: `JH-RNC-${seq++}`,
            organization_id: org.id,
            blood_group: bg,
            component,
            volume_ml: compMeta.volumeMl,
            collection_date: formatDate(collectionDate),
            expiry_date: formatDate(expiryDate),
            status,
            is_reserved: isReserved,
            cold_chain_ok: !coldChainFailed,
            cold_chain_notes: coldChainFailed
              ? 'Temperature excursion >6C detected during storage audit; quarantined pending QA discard'
              : null,
          });
        }
      }
    }
  }

  return units;
}
