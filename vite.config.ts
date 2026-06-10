import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  define: {
    'import.meta.env.VITE_APP_KIND': JSON.stringify('blank'),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/konva/') || id.includes('/node_modules/react-konva/')) {
            return 'konva-vendor'
          }
          return undefined
        },
      },
    },
  },
  resolve: {
    alias: {
      '#books-variant': '/src/books.blank.ts',
    },
  },
})
