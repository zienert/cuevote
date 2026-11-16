import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true, // So production TDZ errors show original file/line in browser
    rollupOptions: {
      output: {
        // Keep large data modules in separate chunks so they are never evaluated at entry init (avoids TDZ).
        // Only single-export modules in app-core (ContextValue, deviceDetection, WebSocketContext).
        // Exclude ConsentContext.jsx / LanguageContext.jsx (two exports each) so they stay in index/App and cannot TDZ inside app-core.
        // Translations are NOT listed here: they are one dynamically-imported
        // module per language now, so Rollup already emits a chunk each and a
        // manual rule would merge them back into the single bundle the split
        // exists to avoid.
        manualChunks(id) {
          if (id.includes('legalContent.js')) return 'legalContent'
          if (id.includes('node_modules')) return undefined
          // Context providers in their own chunk so they always run before App chunk (avoids TDZ 'ce' etc).
          if (id.includes('ConsentContext.jsx') || id.includes('LanguageContext.jsx')) return 'contexts'
          if (id.includes('deviceDetection') || id.includes('ContextValue') || id.includes('WebSocketContext.js')) return 'app-core'
        },
      },
    },
  },
  server: {
    host: '0.0.0.0', // Force IPv4 binding
    port: 5173,
    strictPort: true,
    // The Node server answers /api/* (the Apple Music developer token). In
    // production nginx forwards the same paths, see DEPLOYMENT.md.
    proxy: {
      '/api': 'http://localhost:8080',
    },
    // For local development only; avoid exposing this dev server to the public internet.
    // eslint-disable-next-line no-undef -- vite config runs in Node, `process` is fine here.
    headers: process.env.NODE_ENV === 'development'
      ? {
          'Access-Control-Allow-Origin': 'http://localhost:5173',
        }
      : {},
    // Explicitly handle .apk MIME type
    configureServer: (server) => {
      server.middlewares.use((req, res, next) => {
        if (req.url.endsWith('.apk')) {
          res.setHeader('Content-Type', 'application/vnd.android.package-archive');
        }
        next();
      });
    }
  },
})
