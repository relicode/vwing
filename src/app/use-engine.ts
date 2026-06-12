import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import { GamePhase, WeaponKind } from '$/game/constants'
import { createEngine, type Engine } from '$/game/engine'
import type { EngineStatus } from '$/game/types'

const INITIAL_STATUS: EngineStatus = {
  phase: GamePhase.TITLE,
  score: 0,
  best: 0,
  weapon: WeaponKind.SCATTERGUN,
  charge: 0,
  troops: 0,
  squad: WeaponKind.SCATTERGUN,
  homeCapture: 0,
  enemyCapture: 0,
  respawnIn: 0,
}

export type EngineBoot = { engine: Engine | undefined; error: string | undefined }

// Boots the PixiJS engine once, tearing it down on unmount. `engine` is undefined until ready;
// `error` is set if the WebGL/Pixi boot fails (so the UI can offer an escape hatch).
export const useEngine = (): EngineBoot => {
  const [engine, setEngine] = useState<Engine>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let disposed = false
    let created: Engine | undefined
    createEngine()
      .then((instance) => {
        if (disposed) {
          instance.destroy()
          return
        }
        created = instance
        setEngine(instance)
      })
      .catch((boot: unknown) => {
        if (!disposed) setError(boot instanceof Error ? boot.message : 'Failed to start the game engine')
      })
    return () => {
      disposed = true
      created?.destroy()
    }
  }, [])
  return { engine, error }
}

// Subscribes the React tree to HUD-relevant engine state (score, phase, best).
export const useEngineStatus = (engine: Engine | undefined): EngineStatus => {
  const subscribe = useCallback((onChange: () => void) => (engine ? engine.subscribe(onChange) : () => {}), [engine])
  const getSnapshot = useCallback(() => (engine ? engine.getStatus() : INITIAL_STATUS), [engine])
  return useSyncExternalStore(subscribe, getSnapshot)
}
