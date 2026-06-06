// Squared-distance circle overlap test — no sqrt, used for every entity pair each frame.
export const circlesOverlap = (ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean => {
  const dx = ax - bx
  const dy = ay - by
  const radii = ar + br
  return dx * dx + dy * dy <= radii * radii
}
