import Box from '@mui/material/Box'
import { useEffect, useRef } from 'react'

import type { Engine } from '$/game/engine'

type GameCanvasProps = {
  engine: Engine
}

const GameCanvas = ({ engine }: GameCanvasProps) => {
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.appendChild(engine.canvas)
    return () => {
      engine.canvas.remove()
    }
  }, [engine])
  return <Box ref={hostRef} sx={{ position: 'absolute', inset: 0 }} />
}

export default GameCanvas
