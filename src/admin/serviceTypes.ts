import type { ServiceDefinition } from '../../packages/contracts/src';

/**
 * Presentation-only attributes the studio adds on top of the shared service
 * contract. These live here rather than beside sample data, so the type does
 * not depend on a fixture existing.
 */
export type ServiceTone = 'mint' | 'sky' | 'peach' | 'lemon';
export type ServiceGlyph = 'chat' | 'return' | 'bolt' | 'sparkles';

export interface AdminServiceDefinition extends ServiceDefinition {
  category: string;
  tone: ServiceTone;
  glyph: ServiceGlyph;
}
