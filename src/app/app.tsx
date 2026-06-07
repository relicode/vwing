import Box from '@mui/material/Box'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import { useCallback, useMemo, useState } from 'react'

import GameCanvas from '$/app/game-canvas'
import GameOverScreen from '$/app/game-over-screen'
import Hud from '$/app/hud'
import { createAppTheme } from '$/app/theme'
import TitleScreen from '$/app/title-screen'
import { useEngine, useEngineStatus } from '$/app/use-engine'
import { GamePhase, VIEW_HEIGHT, VIEW_WIDTH, type WeaponKind } from '$/game/constants'

// React + MUI own the chrome (stage frame, HUD, menus); PixiJS owns the canvas inside.
const App = () => {
  const theme = useMemo(() => createAppTheme(), [])
  const engine = useEngine()
  const status = useEngineStatus(engine)
  // Debug: a pinned secondary (undefined = random per life), chosen on the title screen
  // and reused across restarts.
  const [weapon, setWeapon] = useState<WeaponKind | undefined>(undefined)
  const onStart = useCallback(() => engine?.start(weapon), [engine, weapon])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          position: 'fixed',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          bgcolor: 'background.default',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            position: 'relative',
            width: 'min(98dvw, 144dvh)',
            aspectRatio: `${VIEW_WIDTH} / ${VIEW_HEIGHT}`,
            borderRadius: 2,
            overflow: 'hidden',
            boxShadow: '0 0 60px rgba(51,245,163,0.18)',
          }}
        >
          {engine ? <GameCanvas engine={engine} /> : null}
          {status.phase === GamePhase.PLAYING ? <Hud status={status} /> : null}
          {status.phase === GamePhase.TITLE ? (
            <TitleScreen onStart={onStart} ready={Boolean(engine)} weapon={weapon} onWeaponChange={setWeapon} />
          ) : null}
          {status.phase === GamePhase.GAME_OVER ? <GameOverScreen status={status} onRestart={onStart} /> : null}
        </Box>
      </Box>
    </ThemeProvider>
  )
}

export default App
