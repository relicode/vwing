import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'

import { NET_FEED_TTL, PLAYER_PALETTE, SECONDARY_MAX_CHARGE, TROOP_BAY_CAPACITY, WEAPON_CONFIG } from '$/game/constants'
import type { NetStatus } from '$/net/client'
import type { FeedEntry } from '$/net/feed'

type OnlineHudProps = {
  status: NetStatus
  onLeave: () => void
}

const TROOP_SLOTS = Array.from({ length: TROOP_BAY_CAPACITY }, (_, index) => `troop-${index}`)

// One helmet-dome per bay slot: filled = a trooper aboard, hollow = empty rack (matches Hud.tsx).
const TroopPip = ({ filled }: { filled: boolean }) => (
  <Box
    sx={{
      width: 9,
      height: 6,
      borderRadius: '9px 9px 1px 1px',
      bgcolor: filled ? 'primary.main' : 'rgba(255,255,255,0.14)',
      boxShadow: filled ? '0 0 4px rgba(51,245,163,0.8)' : 'none',
    }}
  />
)

// The seat's palette slot as a CSS hex (out-of-range falls back to the enemy rose, like the canvas).
const chipHex = (slot: number): string =>
  `#${(PLAYER_PALETTE[slot] ?? PLAYER_PALETTE[1]).toString(16).padStart(6, '0')}`

// One kill-feed line: names tinted by their seats' colors. The fade is a CSS animation over the
// line's whole TTL (holds, then dims out) so no re-render is needed to age it.
const FeedLine = ({ entry }: { entry: FeedEntry }) => (
  <Typography
    sx={{
      fontSize: 12,
      fontWeight: 600,
      textAlign: 'right',
      textShadow: '0 0 6px rgba(0,0,0,0.8)',
      '@keyframes feedFade': { '0%': { opacity: 1 }, '70%': { opacity: 1 }, '100%': { opacity: 0 } },
      animation: `feedFade ${NET_FEED_TTL}s linear forwards`,
    }}
  >
    {entry.killer ? (
      <>
        <Box component="span" sx={{ color: chipHex(entry.killer.palette) }}>
          {entry.killer.name}
        </Box>
        <Box component="span" sx={{ color: 'text.secondary' }}>
          {' downed '}
        </Box>
      </>
    ) : null}
    <Box component="span" sx={{ color: chipHex(entry.victim.palette) }}>
      {entry.victim.name}
    </Box>
    {entry.killer ? null : (
      <Box component="span" sx={{ color: 'text.secondary' }}>
        {' crashed'}
      </Box>
    )}
  </Typography>
)

const Scoreboard = ({ status }: { status: NetStatus }) => {
  const rows = [...status.players].sort((a, b) => b.score - a.score).slice(0, 8)
  return (
    <Box
      sx={{
        minWidth: 150,
        p: 1,
        borderRadius: 1,
        bgcolor: 'rgba(4,6,12,0.55)',
        border: '1px solid rgba(143,227,255,0.25)',
      }}
    >
      <Typography sx={{ fontSize: 10, letterSpacing: '0.25em', color: 'text.secondary', mb: 0.5 }}>FRAGS</Typography>
      <Stack spacing={0.25}>
        {rows.map((player) => {
          const isSelf = player.id === status.selfId
          return (
            <Stack
              key={player.id}
              direction="row"
              sx={{ justifyContent: 'space-between', gap: 2, opacity: player.eliminated ? 0.5 : 1 }}
            >
              <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    flex: 'none',
                    bgcolor: chipHex(player.palette),
                    boxShadow: `0 0 4px ${chipHex(player.palette)}`,
                    opacity: player.connected ? 1 : 0.45,
                  }}
                />
                <Typography
                  noWrap
                  sx={{
                    fontSize: 13,
                    maxWidth: 110,
                    fontWeight: isSelf ? 800 : 500,
                    // An eliminated pilot is struck through; a merely-disconnected one just greys.
                    textDecoration: player.eliminated ? 'line-through' : 'none',
                    color: isSelf ? 'primary.main' : player.connected ? 'secondary.main' : 'text.disabled',
                  }}
                >
                  {player.name}
                </Typography>
              </Stack>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: isSelf ? 'primary.main' : 'text.secondary' }}>
                {player.score}
              </Typography>
            </Stack>
          )
        })}
      </Stack>
    </Box>
  )
}

const OnlineHud = ({ status, onLeave }: OnlineHudProps) => {
  const ready = status.charge >= (WEAPON_CONFIG[status.weapon].cost / SECONDARY_MAX_CHARGE) * 100
  // The welcome-back toast opens on each reclaimed WELCOME (reclaims only ever increments).
  const [toastFor, setToastFor] = useState(0)
  useEffect(() => {
    if (status.reclaims > 0) setToastFor(status.reclaims)
  }, [status.reclaims])
  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        p: 1.5,
        pointerEvents: 'none',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}
    >
      <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Button
          size="small"
          variant="outlined"
          color="secondary"
          onClick={onLeave}
          sx={{ pointerEvents: 'auto', minWidth: 0, px: 1.5 }}
        >
          Leave
        </Button>
        <Typography sx={{ fontSize: 11, letterSpacing: '0.18em', color: 'text.secondary' }}>{status.game}</Typography>
        {status.stalled ? (
          <Chip label="UNSTABLE" size="small" color="secondary" variant="outlined" sx={{ letterSpacing: '0.18em' }} />
        ) : null}
      </Stack>

      <Stack spacing={0.5} sx={{ alignItems: 'center', pt: 0.25 }}>
        <Typography
          sx={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.12em',
            color: ready ? 'primary.main' : 'text.secondary',
            textShadow: ready ? '0 0 8px currentColor' : 'none',
          }}
        >
          {WEAPON_CONFIG[status.weapon].name.toUpperCase()}
        </Typography>
        <Box sx={{ width: 110, height: 4, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
          <Box
            sx={{
              width: `${status.charge}%`,
              height: '100%',
              bgcolor: ready ? 'primary.main' : 'secondary.main',
              boxShadow: ready ? '0 0 6px rgba(51,245,163,0.9)' : 'none',
              transition: 'width 0.12s linear',
            }}
          />
        </Box>
        <Stack direction="row" spacing={0.5} aria-label={`${status.troops} troopers aboard`} sx={{ pt: 0.25 }}>
          {TROOP_SLOTS.map((slot, index) => (
            <TroopPip key={slot} filled={index < status.troops} />
          ))}
        </Stack>
      </Stack>

      <Stack spacing={1} sx={{ alignItems: 'flex-end' }}>
        <Scoreboard status={status} />
        <Stack spacing={0.25} sx={{ alignItems: 'flex-end' }}>
          {status.feed.map((entry) => (
            <FeedLine key={entry.id} entry={entry} />
          ))}
        </Stack>
      </Stack>

      {status.respawnIn > 0 ? (
        <Typography
          sx={{
            position: 'absolute',
            top: '44%',
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: 20,
            fontWeight: 900,
            letterSpacing: '0.24em',
            color: 'primary.main',
            textShadow: '0 0 16px currentColor',
          }}
        >
          SPAWNING IN {Math.ceil(status.respawnIn)}
        </Typography>
      ) : null}

      <Snackbar
        open={toastFor > 0}
        autoHideDuration={4000}
        onClose={() => setToastFor(0)}
        message="Welcome back — seat restored"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  )
}

export default OnlineHud
