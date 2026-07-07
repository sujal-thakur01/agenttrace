import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    // Output directly into the FastAPI server's static directory so the
    // dashboard is served at the server root after `npm run build`.
    outDir: '../server/static',
    emptyOutDir: true,
  },
})
