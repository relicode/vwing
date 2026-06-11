import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { SECONDARY_MAX_CHARGE, TROOP_BAY_CAPACITY, WEAPON_CONFIG } from '$/game/constants'
import type { EngineStatus } from '$/game/types'

const TROOP_SLOTS = Array.from({ length: TROOP_BAY_CAPACITY }, (_, index) => `troop-${index}`)

type StatProps = {
  label: string
  value: string
  align?: 'left' | 'right'
}

const Stat = ({ label, value, align = 'left' }: StatProps) => (
  <Box sx={{ textAlign: align }}>
    <Typography sx={{ fontSize: 11, letterSpacing: '0.25em', color: 'text.secondary', lineHeight: 1 }}>
      {label}
    </Typography>
    <Typography
      sx={{
        fontSize: 22,
        fontWeight: 700,
        lineHeight: 1.2,
        color: align === 'right' ? 'secondary.main' : 'primary.main',
        textShadow: '0 0 10px currentColor',
      }}
    >
      {value}
    </Typography>
  </Box>
)

// One helmet-dome per bay slot: filled = a trooper aboard, hollow = empty rack.
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

type HudProps = {
  status: EngineStatus
}

const Hud = ({ status }: HudProps) => {
  // "Ready" once the bar holds enough energy to fire the current secondary at least once.
  const ready = status.charge >= (WEAPON_CONFIG[status.weapon].cost / SECONDARY_MAX_CHARGE) * 100
  return (
    <>
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          p: 1.5,
          pointerEvents: 'none',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <Stat label="SCORE" value={status.score.toLocaleString()} />
        <Stack spacing={0.5} sx={{ alignItems: 'center', pt: 0.25 }}>
          <Typography
            sx={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.12em',
              lineHeight: 1.2,
              color: ready ? 'primary.main' : 'text.secondary',
              textShadow: ready ? '0 0 8px currentColor' : 'none',
            }}
          >
            {WEAPON_CONFIG[status.weapon].name.toUpperCase()}
          </Typography>
          <Box sx={{ width: 96, height: 4, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
            <Box
              sx={{
                width: `${status.charge}%`,
                height: '100%',
                bgcolor: ready ? 'primary.main' : 'secondary.main',
                boxShadow: ready ? '0 0 6px rgba(51,245,163,0.9)' : 'none', // glow once ready to fire
                transition: 'width 0.12s linear',
              }}
            />
          </Box>
          <Stack direction="row" spacing={0.5} aria-label={`${status.troops} troopers aboard`} sx={{ pt: 0.25 }}>
            {TROOP_SLOTS.map((slot, index) => (
              <TroopPip key={slot} filled={index < status.troops} />
            ))}
          </Stack>
          <Typography sx={{ fontSize: 10, letterSpacing: '0.2em', lineHeight: 1.1, color: 'text.secondary' }}>
            {WEAPON_CONFIG[status.squad].name.toUpperCase()} SQUAD
          </Typography>
        </Stack>
        <Stat label="BEST" value={status.best.toLocaleString()} align="right" />
      </Box>
      {status.homeCapture > 0 ? (
        <Typography
          sx={{
            position: 'absolute',
            top: 120,
            left: 0,
            right: 0,
            textAlign: 'center',
            pointerEvents: 'none',
            fontSize: 18,
            fontWeight: 900,
            letterSpacing: '0.2em',
            color: 'secondary.main',
            textShadow: '0 0 14px currentColor',
            '@keyframes hudFlash': { '0%': { opacity: 1 }, '50%': { opacity: 0.25 }, '100%': { opacity: 1 } },
            animation: 'hudFlash 0.8s linear infinite',
          }}
        >
          BASE UNDER ATTACK — {status.homeCapture}%
        </Typography>
      ) : null}
      {status.enemyCapture > 0 ? (
        <Typography
          sx={{
            position: 'absolute',
            top: status.homeCapture > 0 ? 148 : 120,
            left: 0,
            right: 0,
            textAlign: 'center',
            pointerEvents: 'none',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.18em',
            color: 'primary.main',
            textShadow: '0 0 10px currentColor',
          }}
        >
          ENEMY BASE {status.enemyCapture}%
        </Typography>
      ) : null}
      {status.respawnIn > 0 ? (
        <Typography
          sx={{
            position: 'absolute',
            top: '44%',
            left: 0,
            right: 0,
            textAlign: 'center',
            pointerEvents: 'none',
            fontSize: 20,
            fontWeight: 900,
            letterSpacing: '0.24em',
            color: 'primary.main',
            textShadow: '0 0 16px currentColor',
          }}
        >
          REINFORCEMENT IN {status.respawnIn}
        </Typography>
      ) : null}
    </>
  )
}

export default Hud
