import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'

import GameCanvas from '$/app/game-canvas'
import OnlineHud from '$/app/online-hud'
import Overlay from '$/app/overlay'
import { useNetStatus } from '$/app/use-net'
import { connectGame, type NetClient, NetPhase } from '$/net/client'
import { JoinIntent } from '$/net/protocol'

type OnlineGameProps = {
  game: string
  pilot: string
  intent: JoinIntent
  onExit: () => void
}

// Owns the lifetime of a single online session: connects the net client on mount, mounts its
// canvas, overlays the HUD/scoreboard, and tears the client down on unmount (or Leave).
const OnlineGame = ({ game, pilot, intent, onExit }: OnlineGameProps) => {
  const [client, setClient] = useState<NetClient>()
  const [bootError, setBootError] = useState<string>()
  const status = useNetStatus(client)

  useEffect(() => {
    let disposed = false
    let created: NetClient | undefined
    connectGame(game, pilot, intent)
      .then((instance) => {
        if (disposed) {
          instance.destroy()
          return
        }
        created = instance
        setClient(instance)
      })
      .catch((error: unknown) => {
        if (!disposed) setBootError(error instanceof Error ? error.message : 'Failed to start the game view')
      })
    return () => {
      disposed = true
      created?.destroy()
    }
  }, [game, pilot, intent])

  return (
    <>
      {client ? <GameCanvas canvas={client.canvas} /> : null}
      {client && status.phase === NetPhase.PLAYING ? <OnlineHud status={status} onLeave={onExit} /> : null}

      {status.phase === NetPhase.CONNECTING && !bootError ? (
        <Overlay>
          <CircularProgress color="primary" />
          <Typography sx={{ color: 'text.secondary', letterSpacing: '0.12em' }}>
            {intent === JoinIntent.HOST ? 'Hosting' : 'Joining'} “{game}”…
          </Typography>
          <Button variant="text" onClick={onExit} sx={{ color: 'text.secondary' }}>
            Cancel
          </Button>
        </Overlay>
      ) : null}

      {bootError || status.phase === NetPhase.DISCONNECTED ? (
        <Overlay>
          <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: '0.12em', color: 'secondary.main' }}>
            DISCONNECTED
          </Typography>
          <Typography sx={{ color: 'text.secondary' }}>{bootError ?? status.error ?? 'The session ended.'}</Typography>
          <Button variant="contained" onClick={onExit} autoFocus sx={{ px: 5, mt: 1 }}>
            Back to lobby
          </Button>
        </Overlay>
      ) : null}
    </>
  )
}

export default OnlineGame
