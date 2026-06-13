import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'

import Overlay from '$/app/Overlay'
import { WEAPON_CONFIG, WEAPON_POOL, type WeaponKind } from '$/game/constants'
import { pingServer } from '$/net/client'
import { APP_VERSION } from '$/version'

type ControlRowProps = {
  keys: string
  action: string
}

const ControlRow = ({ keys, action }: ControlRowProps) => (
  <Stack direction="row" sx={{ justifyContent: 'space-between', width: '100%' }}>
    <Typography sx={{ color: 'text.secondary', fontSize: 13 }}>{action}</Typography>
    <Typography sx={{ color: 'secondary.main', fontSize: 13, fontWeight: 700 }}>{keys}</Typography>
  </Stack>
)

type TitleScreenProps = {
  onPractice: () => void
  onMultiplayer: () => void
  weapon: WeaponKind | undefined // debug override for Practice (undefined = random per life)
  onWeaponChange: (weapon: WeaponKind | undefined) => void
}

const TitleScreen = ({ onPractice, onMultiplayer, weapon, onWeaponChange }: TitleScreenProps) => {
  // Is the game server reachable? undefined = still probing. Multiplayer is gated on this, so
  // the menu never offers a button that dead-ends at a "couldn't connect" lobby.
  const [serverUp, setServerUp] = useState<boolean | undefined>(undefined)
  useEffect(() => {
    let alive = true
    const check = async () => {
      const ok = await pingServer()
      if (alive) setServerUp(ok)
    }
    void check()
    const id = setInterval(check, 5000) // re-probe so a server that comes up later unlocks the button
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  return (
    <Overlay>
      <Typography
        variant="h2"
        sx={{
          fontWeight: 900,
          letterSpacing: '0.16em',
          whiteSpace: 'nowrap',
          color: 'primary.main',
          textShadow: '0 0 24px rgba(51,245,163,0.6)',
        }}
      >
        V-WING
      </Typography>
      <Typography sx={{ color: 'text.secondary', mt: -1, lineHeight: 1.7 }}>
        Fight the gravity.
        <br />
        Dogfight your friends.
      </Typography>
      <Stack direction="row" spacing={1.5} sx={{ mt: 1 }}>
        <Button variant="contained" size="large" onClick={onPractice} autoFocus sx={{ px: 4 }}>
          Practice
        </Button>
        <Button
          variant="outlined"
          size="large"
          color="secondary"
          onClick={onMultiplayer}
          disabled={!serverUp}
          sx={{ px: 4 }}
        >
          Multiplayer
        </Button>
      </Stack>
      {serverUp === false ? (
        <Typography sx={{ color: 'text.disabled', fontSize: 12, mt: -1 }}>No game server reachable</Typography>
      ) : null}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1 }}>
        <Typography sx={{ color: 'text.secondary', fontSize: 13 }}>Practice secondary</Typography>
        <Select
          size="small"
          displayEmpty
          value={weapon ?? ''}
          onChange={(event) => onWeaponChange((event.target.value || undefined) as WeaponKind | undefined)}
          sx={{ minWidth: 180, fontSize: 13, color: 'secondary.main' }}
        >
          <MenuItem value="">Random</MenuItem>
          {WEAPON_POOL.map((kind) => (
            <MenuItem key={kind} value={kind}>
              {WEAPON_CONFIG[kind].name}
            </MenuItem>
          ))}
        </Select>
      </Stack>
      <Box sx={{ width: '100%', mt: 1 }}>
        <ControlRow action="Rotate" keys="← →" />
        <ControlRow action="Thrust" keys="↑" />
        <ControlRow action="Retro-brake" keys="↓" />
        <ControlRow action="Fire" keys="D" />
        <ControlRow action="Secondary" keys="S" />
        <ControlRow action="Deploy troops" keys="A" />
      </Box>
      <Typography sx={{ color: 'text.disabled', fontSize: 11, letterSpacing: '0.18em' }}>v{APP_VERSION}</Typography>
    </Overlay>
  )
}

export default TitleScreen
