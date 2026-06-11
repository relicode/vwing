import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { PLAYER_PALETTE, SECONDARY_MAX_CHARGE, WEAPON_CONFIG } from '$/game/constants'
import type { NetStatus } from '$/net/client'

type OnlineHudProps = {
  status: NetStatus
  onLeave: () => void
}

// The seat's palette slot as a CSS hex (out-of-range falls back to the enemy rose, like the canvas).
const chipHex = (slot: number): string =>
  `#${(PLAYER_PALETTE[slot] ?? PLAYER_PALETTE[1]).toString(16).padStart(6, '0')}`

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
            <Stack key={player.id} direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
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
      </Stack>

      <Scoreboard status={status} />
    </Box>
  )
}

export default OnlineHud
