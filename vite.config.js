import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // ws: true carries the relay path's WebSocket upgrade through to the API server —
      // the string shorthand proxies HTTP only, and the socket would die at Vite.
      '/api': { target: 'http://localhost:3001', ws: true },
      '/health': 'http://localhost:3001',
    },
  },
})
