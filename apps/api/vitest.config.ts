import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    fileParallelism: false,
    env: {
      MYSQL_URL: 'mysql://root:root@localhost:3306/mojomeet_test',
    },
  },
});
