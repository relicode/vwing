import Box from '@mui/material/Box'
import { useEffect, useRef } from 'react'

type GameCanvasProps = {
  canvas: HTMLCanvasElement
}

// Mounts a PixiJS-owned <canvas> (from the offline engine or the online net client) into the
// React tree, detaching it on unmount so the engine/client can be torn down cleanly.
const GameCanvas = ({ canvas }: GameCanvasProps) => {
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.appendChild(canvas)
    return () => {
      canvas.remove()
    }
  }, [canvas])
  return <Box ref={hostRef} sx={{ position: 'absolute', inset: 0 }} />
}

export default GameCanvas
