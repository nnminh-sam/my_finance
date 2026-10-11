import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './contexts/AuthContext'
import { initializeTheme, ThemeProvider } from './contexts/ThemeContext'
import { isPage } from './pages'

initializeTheme()

const root = document.getElementById('root')!
const page = isPage(root.dataset.page) ? root.dataset.page : 'home'

// A cached document must recheck auth/data after back navigation, especially after logout.
window.addEventListener('pageshow', event => {
  if (event.persisted) {
    document.body.style.visibility = 'hidden'
    window.location.reload()
  }
})

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <App page={page} />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
)
