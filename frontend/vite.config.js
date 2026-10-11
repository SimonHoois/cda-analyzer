import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development the API runs on :8000 (uvicorn main:app --reload).
// In production FastAPI serves the built files itself, so everything is same-origin.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8000' } },
})
