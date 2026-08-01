import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Tests exercise the deterministic core and the mock fallbacks; they must
    // never reach a real external system.
    env: { LOG_LEVEL: 'silent' },
  },
});
