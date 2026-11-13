import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@sysdyn/core': path.resolve(__dirname, '../sysdyn-core/src/index.ts')
    }
  },
  server: {
    port: 5173,
    host: true, // listen on all interfaces (needed for container port mapping)
    strictPort: true,
  },
  preview: {
    port: 5173,
    host: true,
    strictPort: true,
  }
});
