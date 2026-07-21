// Fixture spawned as a subprocess by env.test.ts — importing env.ts is what triggers
// fail-fast validation, so this must run in its own process rather than the test runner's.
import { env } from '../../../src/config/env';

console.log('ENV_OK', env.NODE_ENV);
