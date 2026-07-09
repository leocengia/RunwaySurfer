import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Ogni worker usa un DB SQLite temporaneo dedicato (vedi tests/setup.ts).
    setupFiles: ['tests/setup.ts'],
  },
});
