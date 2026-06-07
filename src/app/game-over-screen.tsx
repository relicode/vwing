import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'

import Overlay from '$/app/overlay'
import type { EngineStatus } from '$/game/types'

type GameOverScreenProps = {
  status: EngineStatus
  onRestart: () => void
}

const GameOverScreen = ({ status, onRestart }: GameOverScreenProps) => {
  const isNewBest = status.score > 0 && status.score >= status.best
  return (
    <Overlay>
      <Typography variant="h3" sx={{ fontWeight: 900, letterSpacing: '0.12em', color: 'secondary.main' }}>
        WRECKED
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
      <Button variant="contained" size="large" onClick={onRestart} autoFocus sx={{ px: 5, mt: 1 }}>
        Fly again
      </Button>
    </Overlay>
  )
}

export default GameOverScreen
