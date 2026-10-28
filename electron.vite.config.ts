import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // Dedicated thread for AutoV2 SHA-256 of local model weights.
          modelHashWorker: resolve('src/main/modelHashWorker.ts'),
          analyzeWorker: resolve('src/main/analyzeWorker.ts'),
          promptCoverageWorker: resolve('src/main/promptCoverageWorker.ts'),
          historyBriefWorker: resolve('src/main/comfy/historyBriefWorker.ts'),
          promptPostWorker: resolve('src/main/comfy/promptPostWorker.ts'),
          modelFolderWalkWorker: resolve('src/main/modelFolderWalkWorker.ts'),
          loraSeriesDatasetWorker: resolve('src/main/loraSeriesDatasetWorker.ts'),
          // Dedicated Electron child for preview cover-crop (nativeImage).
          previewDownscaleProcess: resolve(
            'src/main/previewDownscaleProcess.ts',
          ),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve('src/preload/index.ts'),
        formats: ['cjs'],
        fileName: () => 'index.cjs',
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') },
      },
    },
    plugins: [react()],
  },
});
