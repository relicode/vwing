import Box from '@mui/material/Box'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import { useMemo, useState } from 'react'

import LobbyScreen from '$/app/lobby-screen'
import OnlineGame from '$/app/online-game'
import PracticeGame from '$/app/practice-game'
import { createAppTheme } from '$/app/theme'
import TitleScreen from '$/app/title-screen'
import { VIEW_HEIGHT, VIEW_WIDTH, type WeaponKind } from '$/game/constants'

// Top-level routing between the menu, the lobby, the offline Practice run, and an online
// session. Only one game surface (offline engine OR net client) is ever mounted at a time, so
// there's never more than one live WebGL context.
type Route =
  | { view: 'title' }
  | { view: 'lobby' }
  | { view: 'practice' }
  | { view: 'online'; game: string; pilot: string }

const App = () => {
  const theme = useMemo(() => createAppTheme(), [])
  const [route, setRoute] = useState<Route>({ view: 'title' })
  // Debug: a pinned secondary for Practice (undefined = random per life), chosen on the menu.
  const [weapon, setWeapon] = useState<WeaponKind | undefined>(undefined)

  const toTitle = () => setRoute({ view: 'title' })
  const toLobby = () => setRoute({ view: 'lobby' })

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
          {route.view === 'title' ? (
            <TitleScreen
              onPractice={() => setRoute({ view: 'practice' })}
              onMultiplayer={toLobby}
              weapon={weapon}
              onWeaponChange={setWeapon}
            />
          ) : null}
          {route.view === 'lobby' ? (
            <LobbyScreen onJoin={(game, pilot) => setRoute({ view: 'online', game, pilot })} onBack={toTitle} />
          ) : null}
          {route.view === 'practice' ? <PracticeGame weapon={weapon} onExit={toTitle} /> : null}
          {route.view === 'online' ? <OnlineGame game={route.game} pilot={route.pilot} onExit={toLobby} /> : null}
        </Box>
      </Box>
    </ThemeProvider>
  )
}

export default App
