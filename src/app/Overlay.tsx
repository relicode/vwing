import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import type { ReactNode } from 'react'

type OverlayProps = {
  children: ReactNode
}

// Centered translucent panel shared by the title and game-over screens.
const Overlay = ({ children }: OverlayProps) => (
  <Box
    sx={{
      position: 'absolute',
      inset: 0,
      display: 'grid',
      placeItems: 'center',
      p: 3,
      pointerEvents: 'auto',
      background: 'radial-gradient(ellipse at center, rgba(4,6,12,0.5), rgba(4,6,12,0.88))',
      backdropFilter: 'blur(2px)',
    }}
  >
    <Stack
      spacing={2.5}
      sx={{
        alignItems: 'center',
        textAlign: 'center',
        maxWidth: 'min(440px, 92vw)',
        px: 4,
        py: 4,
        borderRadius: 3,
        border: '1px solid',
        borderColor: 'primary.main',
        bgcolor: 'rgba(4,6,12,0.6)',
        boxShadow: '0 0 24px rgba(51,245,163,0.35), inset 0 0 24px rgba(51,245,163,0.06)',
      }}
    >
      {children}
    </Stack>
  </Box>
)

export default Overlay
