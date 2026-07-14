import { describe, expect, it } from 'vitest';
import {
  filterLabourLineItems,
  isLabourSectionHeader,
} from '../../src/billing/lineItemFilter.js';
import type { LabourServiceLineItem } from '../../src/parsing/types.js';

describe('isLabourSectionHeader', () => {
  it('detects Toyota/Maruti table grouping rows', () => {
    expect(isLabourSectionHeader('Oil charges')).toBe(true);
    expect(isLabourSectionHeader('Parts charges')).toBe(true);
    expect(isLabourSectionHeader('Labour charges')).toBe(true);
    expect(isLabourSectionHeader('Service charges')).toBe(true);
  });

  it('does not flag real labour descriptions', () => {
    expect(isLabourSectionHeader('Paid Service/60000 KM EV')).toBe(false);
    expect(isLabourSectionHeader('Wheel alignment')).toBe(false);
    expect(isLabourSectionHeader('Denting & Painting')).toBe(false);
  });
});

describe('filterLabourLineItems', () => {
  it('removes Arpanna "Oil charges" header with zero amount', () => {
    const items: LabourServiceLineItem[] = [
      { labour_description: 'Oil charges', labour_charges: 0 },
    ];
    expect(filterLabourLineItems(items)).toEqual([]);
  });

  it('keeps real labour rows with positive charges', () => {
    const items: LabourServiceLineItem[] = [
      {
        labour_description: 'Paid Service/60000 KM EV',
        labour_code: 'EV4PM60',
        labour_charges: 2700,
      },
    ];
    expect(filterLabourLineItems(items)).toHaveLength(1);
  });

  it('removes zero-charge rows with no code and section-header text', () => {
    const items: LabourServiceLineItem[] = [
      { labour_description: 'Oil charges', labour_charges: 0 },
      { labour_description: 'Parts charges', labour_charges: null },
    ];
    expect(filterLabourLineItems(items)).toEqual([]);
  });

  it('keeps zero-charge labour when a job code is present', () => {
    const items: LabourServiceLineItem[] = [
      { labour_description: 'Warranty check', labour_code: 'WC01', labour_charges: 0 },
    ];
    expect(filterLabourLineItems(items)).toHaveLength(1);
  });
});
