import { describe, expect, it } from 'vitest';
import { GASZIP_FORWARDER_DEFAULT, bridgeForCallTarget } from '../src/utils/bridge-targets.js';

// Doma (97477), added 2026-10-02: Relay's standard depository only; Gas.zip does not serve it
describe('Doma bridge targets', () => {
  it('allows Relay and refuses Gas.zip and unknown contracts', () => {
    expect(bridgeForCallTarget(97477, '0x4cD00E387622C35bDDB9b4c962C136462338BC31')).toBe('relay');
    expect(bridgeForCallTarget(97477, GASZIP_FORWARDER_DEFAULT)).toBeNull();
    // ...while a chain Gas.zip serves accepts it
    expect(bridgeForCallTarget(8453, GASZIP_FORWARDER_DEFAULT)).toBe('gaszip');
    expect(bridgeForCallTarget(97477, '0x000000000000000000000000000000000000dEaD')).toBeNull();
  });
});
