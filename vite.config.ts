import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const appKind = mode === 'visualizer' ? 'visualizer' : mode === 'textbook' ? 'textbook' : 'blank'
  return {
    plugins: [react()],
    publicDir: appKind === 'textbook' ? 'public-textbook' : 'public',
    define: {
      'import.meta.env.VITE_APP_KIND': JSON.stringify(appKind),
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
        '#books-variant': appKind === 'textbook' ? '/src/books.textbook.ts' : '/src/books.blank.ts',
      },
    },
  }
})
