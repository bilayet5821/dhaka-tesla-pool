import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Keep DB-mutating files sequential even though each suite uses its own schema.
    fileParallelism: false,
  },
});
