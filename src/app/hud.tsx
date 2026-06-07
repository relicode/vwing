import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { SHIP_START_LIVES, WEAPON_CONFIG } from '$/game/constants'
import type { EngineStatus } from '$/game/types'

// Stable per-slot keys (lives only ever counts down from the max), so the life pips
// never use an array index as their React key.
const LIFE_SLOTS = Array.from({ length: SHIP_START_LIVES }, (_, index) => `life-${index}`)

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

const ShipPip = () => (
  <Box
    sx={{
      width: 13,
      height: 15,
      bgcolor: 'secondary.main',
      clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)',
      filter: 'drop-shadow(0 0 4px rgba(143,227,255,0.85))',
    }}
  />
)

type HudProps = {
  status: EngineStatus
}

const Hud = ({ status }: HudProps) => (
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
      <Stack direction="row" spacing={0.75} aria-label={`${status.lives} lives`}>
        {LIFE_SLOTS.slice(0, status.lives).map((slot) => (
          <ShipPip key={slot} />
        ))}
      </Stack>
      <Typography
        sx={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.12em',
          lineHeight: 1.2,
          color: status.ammo > 0 ? 'primary.main' : 'text.secondary',
          textShadow: status.ammo > 0 ? '0 0 8px currentColor' : 'none',
        }}
      >
        {WEAPON_CONFIG[status.weapon].name.toUpperCase()}
        {status.ammo > 0 ? ` ×${status.ammo}` : ''}
      </Typography>
    </Stack>
    <Stat label="BEST" value={status.best.toLocaleString()} align="right" />
  </Box>
)

export default Hud
