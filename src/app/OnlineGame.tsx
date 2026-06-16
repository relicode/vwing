import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'

import GameCanvas from '$/app/GameCanvas'
import OnlineHud from '$/app/OnlineHud'
import Overlay from '$/app/Overlay'
import { useNetStatus } from '$/app/use-net'
import { NET_RECONNECT_DELAYS_MS } from '$/game/constants'
import { connectGame, type NetClient, NetOutcome, NetPhase, type NetStatus } from '$/net/client'
import { JoinIntent } from '$/net/protocol'

// The base-war terminal screen, shown over the (still-drawn, spectated) world once this pilot's
// match is decided — won, eliminated mid-fight, or beaten to the last barracks by someone else.
const RESULT_COPY: Record<
  Exclude<NetOutcome, NetOutcome.PLAYING>,
  { title: string; color: string; sub: (winner: string | undefined) => string }
> = {
  [NetOutcome.VICTORY]: {
    title: 'VICTORY',
    color: 'primary.main',
    sub: () => 'The last barracks standing is yours.',
  },
  [NetOutcome.ELIMINATED]: {
    title: 'ELIMINATED',
    color: 'secondary.main',
    sub: () => 'Your last base fell — the battle rages on without you.',
  },
  [NetOutcome.DEFEAT]: {
    title: 'DEFEAT',
    color: 'secondary.main',
    sub: (winner) => (winner ? `${winner} captured the field.` : 'The field has been taken.'),
  },
  [NetOutcome.DRAW]: {
    title: 'DRAW',
    color: 'text.primary',
    sub: () => 'The last barracks fell together — no one holds the field.',
  },
}

const MatchResult = ({ status, onExit }: { status: NetStatus; onExit: () => void }) => {
  const copy = status.outcome === NetOutcome.PLAYING ? undefined : RESULT_COPY[status.outcome]
  if (!copy) return undefined
  return (
    <Overlay>
      <Typography variant="h3" sx={{ fontWeight: 900, letterSpacing: '0.14em', color: copy.color }}>
        {copy.title}
      </Typography>
      <Typography sx={{ color: 'text.secondary' }}>{copy.sub(status.winnerName)}</Typography>
      <Button variant="contained" onClick={onExit} autoFocus sx={{ px: 5, mt: 1 }}>
        Back to lobby
      </Button>
    </Overlay>
  )
}

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
      {client && status.phase === NetPhase.PLAYING && status.outcome === NetOutcome.PLAYING ? (
        <OnlineHud status={status} onLeave={onExit} />
      ) : null}
      {client && status.phase === NetPhase.PLAYING && status.outcome !== NetOutcome.PLAYING ? (
        <MatchResult status={status} onExit={onExit} />
      ) : null}

      {status.phase === NetPhase.RECONNECTING ? (
        // The canvas stays mounted under the dim — the world freezes rather than vanishing,
        // and the WELCOME of a successful re-dial lifts the banner without remounting anything.
        <Overlay>
          <CircularProgress color="secondary" />
          <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: '0.14em', color: 'secondary.main' }}>
            CONNECTION LOST
          </Typography>
          <Typography sx={{ color: 'text.secondary' }}>
            Reconnecting ({status.attempt}/{NET_RECONNECT_DELAYS_MS.length})…
          </Typography>
          <Button variant="text" onClick={onExit} sx={{ color: 'text.secondary' }}>
            Back to lobby
          </Button>
        </Overlay>
      ) : null}

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
