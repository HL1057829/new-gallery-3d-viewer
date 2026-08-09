/** @file Vite config with shimmed aliases for browser builds. */

import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: '/new-gallery-3d-viewer/',

  resolve: {
    alias: {
      os: resolve(__dirname, 'src/shims/os.js')
    }
  }
});
