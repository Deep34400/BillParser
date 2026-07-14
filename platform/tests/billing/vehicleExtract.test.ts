import { describe, expect, it } from 'vitest';
import {
  extractRegistrationFromMarkdown,
  normalizeRegistrationNumber,
  normalizeVehicleDetails,
} from '../../src/billing/vehicleExtract.js';

const ARPANNA_HEADER =
  'Tax Invoice No./Sales Invoice TXA25-08492(Cash) Reg. No. MH01FE2778';

describe('normalizeRegistrationNumber', () => {
  it('removes spaces and uppercases Indian reg numbers', () => {
    expect(normalizeRegistrationNumber('KA 51 AK 8534')).toBe('KA51AK8534');
    expect(normalizeRegistrationNumber('HR55 AW 8692')).toBe('HR55AW8692');
  });

  it('keeps compact reg numbers unchanged', () => {
    expect(normalizeRegistrationNumber('MH01FE2778')).toBe('MH01FE2778');
  });

  it('returns null for invalid tokens', () => {
    expect(normalizeRegistrationNumber('TOYOTA GLANZA')).toBeNull();
    expect(normalizeRegistrationNumber('')).toBeNull();
  });
});

describe('extractRegistrationFromMarkdown', () => {
  it('extracts Reg. No. from Arpanna Toyota invoice header', () => {
    expect(extractRegistrationFromMarkdown(ARPANNA_HEADER)).toBe('MH01FE2778');
  });

  it('extracts spaced registration numbers', () => {
    const md = 'Vehicle Reg No: KA 51 AK 8534';
    expect(extractRegistrationFromMarkdown(md)).toBe('KA51AK8534');
  });

  it('extracts Registration Number label', () => {
    expect(extractRegistrationFromMarkdown('Registration Number HR55AW8692')).toBe('HR55AW8692');
  });
});

describe('normalizeVehicleDetails', () => {
  it('fills missing registration from markdown', () => {
    const out = normalizeVehicleDetails(
      { chassis_number: 'MBHJWC13SSLB54534', registration_number: null, mileage_odometer_reading: 9678 },
      ARPANNA_HEADER,
    );
    expect(out?.registration_number).toBe('MH01FE2778');
  });

  it('normalizes spaced registration from LLM output', () => {
    const out = normalizeVehicleDetails(
      { registration_number: 'KA 51 AK 8534' },
      null,
    );
    expect(out?.registration_number).toBe('KA51AK8534');
  });
});
