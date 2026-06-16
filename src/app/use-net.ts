import { useCallback, useSyncExternalStore } from 'react'

import { WeaponKind } from '$/game/constants'
import { type NetClient, NetOutcome, NetPhase, type NetStatus } from '$/net/client'

const INITIAL_STATUS: NetStatus = {
  phase: NetPhase.CONNECTING,
  game: '',
  selfId: -1,
  players: [],
  score: 0,
  weapon: WeaponKind.SCATTERGUN,
  charge: 0,
  troops: 0,
  attempt: 0,
  reclaims: 0,
  feed: [],
  respawnIn: 0,
  stalled: false,
  outcome: NetOutcome.PLAYING,
  winnerName: undefined,
  homeUnderAttack: 0,
  homeAttacker: undefined,
  bestAssault: 0,
  basesHeld: 0,
  seatBases: {},
  error: undefined,
}

// Subscribes the React tree to the net client's HUD-relevant state (phase, scoreboard,
// weapon, charge), mirroring useEngineStatus for the offline engine.
export const useNetStatus = (client: NetClient | undefined): NetStatus => {
  const subscribe = useCallback((onChange: () => void) => (client ? client.subscribe(onChange) : () => {}), [client])
  const getSnapshot = useCallback(() => (client ? client.getStatus() : INITIAL_STATUS), [client])
  return useSyncExternalStore(subscribe, getSnapshot)
}
