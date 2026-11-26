import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // built by Vercel (its system variable): only there is Web Analytics served, at /_vercel/insights
  define: { 'import.meta.env.VITE_ON_VERCEL': JSON.stringify(process.env.VERCEL ? '1' : '') },
  build: {
    // every built file (including chunks loaded later with import(), like Firebase): public/sw.js reads it
    // to keep them all for offline use
    manifest: 'asset-manifest.json',
    rolldownOptions: {
      output: {
        // libraries change rarely: in their own file, a new version of the app does not download them again
        codeSplitting: {
          groups: [{ name: 'vendor', test: /node_modules[\/](react|react-dom|scheduler|chess\.js|react-chessboard)[\/]/ }],
        },
      },
    },
  },
})
