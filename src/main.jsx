import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { installAuth } from './accessToken.js'
import AccessGate from './AccessGate.jsx'

// Before anything renders: every /api/ fetch from here on carries the token, if there is
// one. See src/accessToken.js for why this is a patch rather than a parameter.
installAuth()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AccessGate>
      <App />
    </AccessGate>
  </StrictMode>,
)
