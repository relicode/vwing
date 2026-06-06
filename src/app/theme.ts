import { createTheme, type Theme } from '@mui/material/styles'

// Pure factory (no module-level singleton) so it composes cleanly with React memoization.
export const createAppTheme = (): Theme =>
  createTheme({
    palette: {
      mode: 'dark',
      primary: { main: '#33f5a3' },
      secondary: { main: '#8fe3ff' },
      background: { default: '#04060c', paper: 'rgba(9,15,26,0.94)' },
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: '"Orbitron", "Segoe UI", system-ui, sans-serif',
      button: { fontWeight: 700, letterSpacing: '0.12em' },
    },
  })
