import { createRoot } from 'react-dom/client'

import App from '$/app/app'

// No StrictMode: its dev-only double-mount would spin up and tear down a second
// WebGL context on every render, which PixiJS does not appreciate.
const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found')

createRoot(container).render(<App />)
