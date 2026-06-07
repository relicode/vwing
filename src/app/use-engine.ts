import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import { GamePhase, SHIP_START_LIVES, WeaponKind } from '$/game/constants'
import { createEngine, type Engine } from '$/game/engine'
import type { EngineStatus } from '$/game/types'

const INITIAL_STATUS: EngineStatus = {
  phase: GamePhase.TITLE,
  score: 0,
  best: 0,
  lives: SHIP_START_LIVES,
  weapon: WeaponKind.SCATTERGUN,
  ammo: 0,
}

// Boots the PixiJS engine once, tearing it down on unmount. Returns undefined until ready.
export const useEngine = (): Engine | undefined => {
  const [engine, setEngine] = useState<Engine>()
  useEffect(() => {
    let disposed = false
    let created: Engine | undefined
    const boot = async () => {
      const instance = await createEngine()
      if (disposed) {
        instance.destroy()
        return
      }
      created = instance
      setEngine(instance)
    }
    void boot()
    return () => {
      disposed = true
      created?.destroy()
    }
  }, [])
  return engine
}

// Subscribes the React tree to HUD-relevant engine state (score, lives, phase, best).
export const useEngineStatus = (engine: Engine | undefined): EngineStatus => {
  const subscribe = useCallback((onChange: () => void) => (engine ? engine.subscribe(onChange) : () => {}), [engine])
  const getSnapshot = useCallback(() => (engine ? engine.getStatus() : INITIAL_STATUS), [engine])
  return useSyncExternalStore(subscribe, getSnapshot)
}
