import { describe, it, expect } from 'vitest';
import * as schema from '../../src/db/schema.js';

describe('org / plan schema removed', () => {
  it('does not export Organization or OrgMember models', () => {
    expect(schema).not.toHaveProperty('Organization');
    expect(schema).not.toHaveProperty('OrgMember');
  });
});
