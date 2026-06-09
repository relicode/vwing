import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useCallback, useEffect, useState } from 'react'

import Overlay from '$/app/Overlay'
import { NET_GAME_NAME_MAX } from '$/game/constants'
import { fetchGames, serverOrigin } from '$/net/client'
import { type GameSummary, gameNameKey, JoinIntent, sanitizeGameName } from '$/net/protocol'

const PILOT_KEY = 'vwing.pilot'
const readPilot = (): string => globalThis.localStorage?.getItem(PILOT_KEY) ?? ''

type LobbyScreenProps = {
  onJoin: (game: string, pilot: string, intent: JoinIntent) => void
  onBack: () => void
}

const LobbyScreen = ({ onJoin, onBack }: LobbyScreenProps) => {
  const [games, setGames] = useState<GameSummary[]>([])
  const [pilot, setPilot] = useState<string>(readPilot)
  const [host, setHost] = useState('')
  const [error, setError] = useState<string>()
  const [hostError, setHostError] = useState<string>()

  // Poll the lobby every couple of seconds so hosted games appear/disappear live.
  useEffect(() => {
    let alive = true
    const refresh = async () => {
      try {
        const list = await fetchGames()
        if (alive) {
          setGames(list)
          setError(undefined)
        }
      } catch (err) {
        if (alive) setError((err as Error).message)
      }
    }
    void refresh()
    const id = setInterval(refresh, 2000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  const connect = useCallback(
    (game: string, intent: JoinIntent) => {
      const cleanGame = sanitizeGameName(game, NET_GAME_NAME_MAX)
      if (!cleanGame) return
      // Refuse to host onto a name already in the lobby (the server enforces this too — case-
      // insensitively and Unicode-normalized; this is just instant feedback before connecting).
      if (intent === JoinIntent.HOST && games.some((g) => gameNameKey(g.name) === gameNameKey(cleanGame))) {
        setHostError(`“${cleanGame}” is already hosted — pick another name.`)
        return
      }
      const cleanPilot = sanitizeGameName(pilot, NET_GAME_NAME_MAX) || 'Pilot'
      globalThis.localStorage?.setItem(PILOT_KEY, cleanPilot)
      onJoin(cleanGame, cleanPilot, intent)
    },
    [onJoin, pilot, games]
  )

  return (
    <Overlay>
      <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: '0.12em', color: 'primary.main' }}>
        MULTIPLAYER
      </Typography>

      <TextField
        size="small"
        label="Call sign"
        value={pilot}
        onChange={(event) => setPilot(event.target.value)}
        slotProps={{ htmlInput: { maxLength: NET_GAME_NAME_MAX } }}
        sx={{ width: '100%' }}
      />

      <Stack spacing={0.5} sx={{ width: '100%' }}>
        <Stack direction="row" spacing={1} sx={{ width: '100%' }}>
          <TextField
            size="small"
            label="Host a game"
            placeholder="game name"
            value={host}
            error={Boolean(hostError)}
            onChange={(event) => {
              setHost(event.target.value)
              setHostError(undefined)
            }}
            onKeyDown={(event) => event.key === 'Enter' && connect(host, JoinIntent.HOST)}
            slotProps={{ htmlInput: { maxLength: NET_GAME_NAME_MAX } }}
            sx={{ flex: 1 }}
          />
          <Button
            variant="contained"
            onClick={() => connect(host, JoinIntent.HOST)}
            disabled={!sanitizeGameName(host, NET_GAME_NAME_MAX)}
          >
            Host
          </Button>
        </Stack>
        {hostError ? (
          <Typography sx={{ color: 'error.main', fontSize: 12, alignSelf: 'flex-start' }}>{hostError}</Typography>
        ) : null}
      </Stack>

      <Box sx={{ width: '100%' }}>
        <Typography sx={{ fontSize: 11, letterSpacing: '0.25em', color: 'text.secondary', mb: 0.5 }}>
          OPEN GAMES
        </Typography>
        <Stack spacing={0.5} sx={{ width: '100%', maxHeight: 180, overflowY: 'auto' }}>
          {error ? (
            <Typography sx={{ color: 'error.main', fontSize: 13 }}>{error}</Typography>
          ) : games.length === 0 ? (
            <Typography sx={{ color: 'text.secondary', fontSize: 13 }}>No games yet — host one above.</Typography>
          ) : (
            games.map((game) => (
              <Stack
                key={game.name}
                direction="row"
                sx={{ alignItems: 'center', justifyContent: 'space-between', width: '100%' }}
              >
                <Typography sx={{ color: 'secondary.main', fontWeight: 700, fontSize: 14 }}>{game.name}</Typography>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>
                    {game.players}/{game.maxPlayers}
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={game.players >= game.maxPlayers}
                    onClick={() => connect(game.name, JoinIntent.JOIN)}
                  >
                    Join
                  </Button>
                </Stack>
              </Stack>
            ))
          )}
        </Stack>
      </Box>

      <Typography sx={{ color: 'text.disabled', fontSize: 11 }}>server: {serverOrigin()}</Typography>
      <Button variant="text" onClick={onBack} sx={{ color: 'text.secondary' }}>
        ← Back
      </Button>
    </Overlay>
  )
}

export default LobbyScreen
