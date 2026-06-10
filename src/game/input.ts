const LEFT_KEYS = ['ArrowLeft', 'KeyA']
const RIGHT_KEYS = ['ArrowRight', 'KeyD']
const THRUST_KEYS = ['ArrowUp', 'KeyW']
const REVERSE_KEYS = ['ArrowDown', 'KeyS'] // retro-brake (the two smaller forward nozzles)
const FIRE_KEYS = ['Space', 'KeyJ', 'KeyZ']
const ALT_FIRE_KEYS = ['KeyK', 'ShiftLeft'] // secondary weapon
const DEPLOY_KEYS = ['KeyX', 'KeyL'] // troop drop — X beside Z (fire), L beside K (alt-fire)
const PREVENT_DEFAULT = new Set([
  ...LEFT_KEYS,
  ...RIGHT_KEYS,
  ...THRUST_KEYS,
  ...REVERSE_KEYS,
  ...FIRE_KEYS,
  ...ALT_FIRE_KEYS,
  ...DEPLOY_KEYS,
])

export type Input = {
  turn: () => number // -1 = rotate left, +1 = rotate right, 0 = none
  thrusting: () => boolean
  reversing: () => boolean // retro-brake held (two smaller forward plumes)
  firing: () => boolean
  altFiring: () => boolean // secondary weapon trigger
  deploying: () => boolean // troop-bay drop trigger (streams troopers while held)
  destroy: () => void
}

// A serializable per-frame command — the wire format a networked client streams to the
// authoritative server, which stores the latest one per player and adapts it into an Input.
export type InputSnapshot = {
  turn: number
  thrusting: boolean
  reversing: boolean
  firing: boolean
  altFiring: boolean
  deploying: boolean
}

export const NEUTRAL_INPUT: InputSnapshot = {
  turn: 0,
  thrusting: false,
  reversing: false,
  firing: false,
  altFiring: false,
  deploying: false,
}

// Snapshot what an Input currently reads — used client-side to package the keyboard state
// for the network each tick.
export const readSnapshot = (input: Input): InputSnapshot => ({
  turn: input.turn(),
  thrusting: input.thrusting(),
  reversing: input.reversing(),
  firing: input.firing(),
  altFiring: input.altFiring(),
  deploying: input.deploying(),
})

// Wrap a live snapshot object as an Input: the holder mutates `state` from inbound
// messages and the sim reads through these accessors each frame.
export const inputFromSnapshot = (state: InputSnapshot): Input => ({
  turn: () => state.turn,
  thrusting: () => state.thrusting,
  reversing: () => state.reversing,
  firing: () => state.firing,
  altFiring: () => state.altFiring,
  deploying: () => state.deploying,
  destroy: () => {},
})

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
  const reversing = (): boolean => anyDown(REVERSE_KEYS)
  const firing = (): boolean => anyDown(FIRE_KEYS)
  const altFiring = (): boolean => anyDown(ALT_FIRE_KEYS)
  const deploying = (): boolean => anyDown(DEPLOY_KEYS)

  const destroy = () => {
    target.removeEventListener('keydown', onKeyDown)
    target.removeEventListener('keyup', onKeyUp)
    target.removeEventListener('blur', onBlur)
  }

  return { turn, thrusting, reversing, firing, altFiring, deploying, destroy }
}
