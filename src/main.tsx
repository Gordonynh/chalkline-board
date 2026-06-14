import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

async function bootstrap() {
  const App =
    import.meta.env.VITE_APP_KIND === 'visualizer'
      ? (await import('./ProjectionApp')).default
      : (await import('./App')).default

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
