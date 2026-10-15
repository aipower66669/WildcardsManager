import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/domain/**/*.test.ts',
      'src/main/**/*.test.ts',
      'src/shared/**/*.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@domain': resolve('src/domain'),
      '@shared': resolve('src/shared'),
    },
  },
});
