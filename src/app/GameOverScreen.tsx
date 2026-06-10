import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import Overlay from '$/app/Overlay'
import type { EngineStatus } from '$/game/types'

type GameOverScreenProps = {
  status: EngineStatus
  victory: boolean // true = the enemy base fell and their ship went down with it
  onRestart: () => void
  onExit: () => void
}

const GameOverScreen = ({ status, victory, onRestart, onExit }: GameOverScreenProps) => {
  const isNewBest = status.score > 0 && status.score >= status.best
  return (
    <Overlay>
      <Typography
        variant="h3"
        sx={{
          fontWeight: 900,
          letterSpacing: '0.12em',
          color: victory ? 'primary.main' : 'secondary.main',
          textShadow: victory ? '0 0 24px rgba(51,245,163,0.6)' : undefined,
        }}
      >
        {victory ? 'BASE SECURED — VICTORY' : 'WRECKED'}
      </Typography>
      <Typography sx={{ color: 'text.secondary' }}>Final score</Typography>
      <Typography
        variant="h4"
        sx={{ fontWeight: 700, color: 'primary.main', textShadow: '0 0 16px rgba(51,245,163,0.5)', mt: -1.5 }}
      >
        {status.score.toLocaleString()}
      </Typography>
      <Typography sx={{ color: isNewBest ? 'primary.main' : 'text.secondary', fontWeight: isNewBest ? 700 : 400 }}>
        {isNewBest ? 'NEW BEST!' : `Best ${status.best.toLocaleString()}`}
      </Typography>
      <Stack direction="row" spacing={1.5} sx={{ mt: 1 }}>
        <Button variant="contained" size="large" onClick={onRestart} autoFocus sx={{ px: 4 }}>
          Fly again
        </Button>
        <Button variant="text" size="large" onClick={onExit} sx={{ color: 'text.secondary' }}>
          Menu
        </Button>
      </Stack>
    </Overlay>
  )
}

export default GameOverScreen
