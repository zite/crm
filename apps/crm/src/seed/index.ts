import { CORE_PHASES, type SeedPhase } from './core';
import { LEADS_PHASES } from './leads';
import { QUOTES_PHASES } from './quotes';
import { OUTREACH_PHASES } from './outreach';
import { MEETINGS_PHASES } from './meetings';
import { SETTINGS_PHASES } from './settings';

/**
 * Every seed phase, in order. Core builds the organization, its people,
 * companies, contacts, deals, activity and leads; each area then adds its own
 * phases in its own file, so nobody edits someone else's seed.
 */
export const SEED_PHASES: SeedPhase[] = [...CORE_PHASES, ...LEADS_PHASES, ...QUOTES_PHASES, ...OUTREACH_PHASES, ...MEETINGS_PHASES, ...SETTINGS_PHASES];

export type { SeedContext, SeedPhase } from './core';
export { seedContext } from './core';
