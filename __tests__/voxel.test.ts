import { describe, expect, test } from 'bun:test'

import { SurfaceMaterial, VOXEL_CELL, WORLD_HEIGHT, WORLD_WIDTH } from '$/game/constants'
import { carveVoxel, createVoxelTerrain, hasDebris, stepVoxel, voxelToBlocks } from '$/game/voxel'

// Count filled destructible cells in the static grid (excludes bedrock + falling debris).
const filledCells = (mat: Uint8Array): number => {
  let n = 0
  for (const m of mat) if (m !== 0) n += 1
  return n
}

describe('createVoxelTerrain', () => {
  test('sizes the grid to the world and rasterizes the hand-authored arena', () => {
    const vt = createVoxelTerrain()
    expect(vt.cols).toBe(Math.ceil(WORLD_WIDTH / VOXEL_CELL))
    expect(vt.rows).toBe(Math.ceil(WORLD_HEIGHT / VOXEL_CELL))
    expect(vt.bedrock.length).toBeGreaterThan(0) // the border frame + cave are bedrock anchors
    expect(filledCells(vt.mat)).toBeGreaterThan(0) // rock/grass/ice voxelized into the grid
  })

  test('floating islands start pinned (aloft), so nothing falls before a shot lands', () => {
    const vt = createVoxelTerrain()
    expect(vt.pinned.length).toBeGreaterThan(0) // islands A/B/C are pinned components
    expect(hasDebris(vt)).toBe(false)
  })

  test('derives a compact block set (fewer rectangles than filled cells)', () => {
    const vt = createVoxelTerrain()
    const blocks = voxelToBlocks(vt)
    expect(blocks.length).toBeGreaterThan(0)
    expect(blocks.length).toBeLessThan(filledCells(vt.mat)) // greedy meshing actually merges
    expect(blocks.some((b) => b.material === SurfaceMaterial.BEDROCK)).toBe(true)
  })
})

describe('carveVoxel', () => {
  test('open air / bedrock carves nothing', () => {
    const vt = createVoxelTerrain()
    expect(carveVoxel(vt, 5, 5, 12)).toBe(false) // top-left bedrock corner: no destructible cells
    expect(carveVoxel(vt, WORLD_WIDTH / 2, 40, 12)).toBe(false) // open sky just under the top border
  })

  test('a crater removes cells sized to its radius, and a repeat carve is a no-op', () => {
    const vt = createVoxelTerrain()
    const before = filledCells(vt.mat)
    // Center of the submerged rock pillar at block(420,1300,240,…).
    expect(carveVoxel(vt, 540, 1380, 18)).toBe(true)
    const after = filledCells(vt.mat)
    expect(after).toBeLessThan(before)
    expect(carveVoxel(vt, 540, 1380, 18)).toBe(false) // already hollowed: nothing left to remove
  })

  test('biting into a floating island looses it as falling debris', () => {
    const vt = createVoxelTerrain()
    const pinsBefore = vt.pinned.length
    // Island C — the standalone rock platform at block(1900,760,160,70).
    expect(carveVoxel(vt, 1980, 795, 12)).toBe(true)
    expect(hasDebris(vt)).toBe(true) // the island broke loose
    expect(vt.pinned.length).toBeLessThan(pinsBefore) // its pin dissolved; the other islands keep theirs
  })
})

describe('connectivity + debris', () => {
  // Slice clean through a grounded pillar near its top, leaving a thin cap unsupported.
  const severPillarTop = (vt: ReturnType<typeof createVoxelTerrain>): void => {
    for (let x = 422; x < 658; x += VOXEL_CELL) carveVoxel(vt, x, 1322, VOXEL_CELL)
  }

  test('a piece cut off from the main static surface becomes debris and then settles', () => {
    const vt = createVoxelTerrain()
    severPillarTop(vt)
    expect(hasDebris(vt)).toBe(true) // the cap above the slice lost its footing

    // Let the chunk fall; it must come to rest (back into the static grid) in finite time.
    let settled = false
    for (let i = 0; i < 600 && !settled; i += 1) {
      stepVoxel(vt, 1 / 30)
      if (!hasDebris(vt)) settled = true
    }
    expect(settled).toBe(true)
  })

  test('stepVoxel reports no change when there is no debris in flight', () => {
    const vt = createVoxelTerrain()
    expect(stepVoxel(vt, 1 / 30)).toBe(false)
  })

  test('a falling chunk conserves material: cells lost from the grid land back into it', () => {
    const vt = createVoxelTerrain()
    const before = filledCells(vt.mat)
    carveVoxel(vt, 1980, 795, 12) // loose island C
    const removedToAir = before - filledCells(vt.mat) // cells now in flight (lifted out of the grid)
    expect(removedToAir).toBeGreaterThan(0)
    for (let i = 0; i < 600 && hasDebris(vt); i += 1) stepVoxel(vt, 1 / 30)
    expect(hasDebris(vt)).toBe(false)
    // After settling, the lifted cells are stamped back: the grid regains (most of) them.
    expect(filledCells(vt.mat)).toBeGreaterThan(before - removedToAir)
  })
})
