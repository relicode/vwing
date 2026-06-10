import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useCallback, useEffect, useRef } from 'react'

import GameCanvas from '$/app/GameCanvas'
import GameOverScreen from '$/app/GameOverScreen'
import Hud from '$/app/Hud'
import Overlay from '$/app/Overlay'
import { useEngine, useEngineStatus } from '$/app/use-engine'
import { GamePhase, type WeaponKind } from '$/game/constants'

type PracticeGameProps = {
  weapon: WeaponKind | undefined // debug secondary override (undefined = random per life)
  onExit: () => void
}

// The offline "vs bot" run: boots the local engine, auto-launches once it's ready, and lets
// the player restart or bail back to the menu. (The online flow lives in OnlineGame.)
const PracticeGame = ({ weapon, onExit }: PracticeGameProps) => {
  const { engine, error } = useEngine()
  const status = useEngineStatus(engine)
  const launched = useRef(false)

  useEffect(() => {
    if (engine && !launched.current) {
      launched.current = true
      engine.start(weapon)
    }
  }, [engine, weapon])

  const onRestart = useCallback(() => engine?.start(weapon), [engine, weapon])

  if (error) {
    return (
      <Overlay>
        <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: '0.12em', color: 'secondary.main' }}>
          NO SIGNAL
        </Typography>
        <Typography sx={{ color: 'text.secondary' }}>{error}</Typography>
        <Button variant="contained" onClick={onExit} autoFocus sx={{ px: 5, mt: 1 }}>
          Back to menu
        </Button>
      </Overlay>
    )
  }

  return (
    <>
      {engine ? <GameCanvas canvas={engine.canvas} /> : null}
      {status.phase === GamePhase.PLAYING ? <Hud status={status} /> : null}
      {status.phase === GamePhase.PLAYING ? (
        <Box sx={{ position: 'absolute', bottom: 0, left: 0, p: 1.5 }}>
          <Button
            size="small"
            variant="outlined"
            color="secondary"
            onClick={onExit}
            sx={{ minWidth: 0, px: 1.5, opacity: 0.7 }}
          >
            Menu
          </Button>
        </Box>
      ) : null}
      {status.phase === GamePhase.GAME_OVER || status.phase === GamePhase.VICTORY ? (
        <GameOverScreen
          status={status}
          victory={status.phase === GamePhase.VICTORY}
          onRestart={onRestart}
          onExit={onExit}
        />
      ) : null}
    </>
  )
}

export default PracticeGame
