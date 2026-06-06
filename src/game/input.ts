const LEFT_KEYS = ['ArrowLeft', 'KeyA']
const RIGHT_KEYS = ['ArrowRight', 'KeyD']
const THRUST_KEYS = ['ArrowUp', 'KeyW']
const FIRE_KEYS = ['Space', 'KeyJ', 'KeyZ']
const PREVENT_DEFAULT = new Set([...LEFT_KEYS, ...RIGHT_KEYS, ...THRUST_KEYS, ...FIRE_KEYS])

export type Input = {
  turn: () => number // -1 = rotate left, +1 = rotate right, 0 = none
  thrusting: () => boolean
  firing: () => boolean
  destroy: () => void
}

// Tracks held keys via window listeners. Default scrolling is suppressed only when
// nothing is focused, so MUI buttons in the shell keep their keyboard activation.
export const createInput = (target: Window): Input => {
  const down = new Set<string>()

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target === target.document.body && PREVENT_DEFAULT.has(event.code)) event.preventDefault()
    down.add(event.code)
  }
  const onKeyUp = (event: KeyboardEvent) => {
    down.delete(event.code)
  }
  const onBlur = () => down.clear()

  target.addEventListener('keydown', onKeyDown)
  target.addEventListener('keyup', onKeyUp)
  target.addEventListener('blur', onBlur)

  const anyDown = (keys: readonly string[]): boolean => keys.some((key) => down.has(key))

  const turn = (): number => (anyDown(RIGHT_KEYS) ? 1 : 0) - (anyDown(LEFT_KEYS) ? 1 : 0)
  const thrusting = (): boolean => anyDown(THRUST_KEYS)
  const firing = (): boolean => anyDown(FIRE_KEYS)

  const destroy = () => {
    target.removeEventListener('keydown', onKeyDown)
    target.removeEventListener('keyup', onKeyUp)
    target.removeEventListener('blur', onBlur)
  }

  return { turn, thrusting, firing, destroy }
}
