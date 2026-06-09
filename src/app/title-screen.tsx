import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import Overlay from '$/app/overlay'
import { WEAPON_CONFIG, WEAPON_POOL, type WeaponKind } from '$/game/constants'

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

const TitleScreen = ({ onPractice, onMultiplayer, weapon, onWeaponChange }: TitleScreenProps) => (
  <Overlay>
    <Typography
      variant="h2"
      sx={{
        fontWeight: 900,
        letterSpacing: '0.16em',
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
      <Button variant="contained" size="large" onClick={onMultiplayer} autoFocus sx={{ px: 4 }}>
        Multiplayer
      </Button>
      <Button variant="outlined" size="large" color="secondary" onClick={onPractice} sx={{ px: 4 }}>
        Practice
      </Button>
    </Stack>
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
      <ControlRow action="Rotate" keys="← → / A D" />
      <ControlRow action="Thrust" keys="↑ / W" />
      <ControlRow action="Fire" keys="Space / J" />
      <ControlRow action="Secondary" keys="K / Shift" />
    </Box>
  </Overlay>
)

export default TitleScreen
