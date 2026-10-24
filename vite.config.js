import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // NOTE on local development:
  // - `npm run dev` → Vite on :5173, API calls fall back to static data (no CBR)
  // - `vercel dev`  → Full environment: API routes + Vite frontend, live CBR data
})
