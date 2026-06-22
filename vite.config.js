import { defineConfig } from 'vite'

export default defineConfig({
  // Handle .wasm files as assets so they're served correctly
  assetsInclude: ['**/*.wasm'],

  // Allow importing text files as raw strings (templates, lua filters)
  // (Vite supports ?raw imports natively)

  optimizeDeps: {
    // Exclude WASM packages from pre-bundling — they manage their own loading
    exclude: ['pandoc-wasm'],
  },

  build: {
    target: 'esnext', // Required for top-level await and modern WASM support
    rollupOptions: {
      output: {
        // Keep WASM assets as separate files
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },

  server: {
    headers: {
      // Required for SharedArrayBuffer (used by some WASM runtimes)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
