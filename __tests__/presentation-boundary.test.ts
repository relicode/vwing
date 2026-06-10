import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

// The sim/presentation boundary as a test (PLAN.md Phase 1): the deterministic sim must run
// headlessly on the Bun server and under bun:test, so pixi.js must never be reachable from the
// import graph of any headless entry point — and only the presentation layer may import it at all.

const ROOT = resolve(import.meta.dir, '..')
const SRC = join(ROOT, 'src')

// The only files allowed to import pixi.js directly: the presentation layer. engine.ts and
// net/client.ts are listed ahead of need — they own the Application lifecycle from Phase 2 on,
// and src/game/render/** is where renderer.ts splits in Phase 3. Renaming an allowlisted file
// (e.g. to .tsx) requires updating this list — the offender scan below covers .tsx too.
const PIXI_IMPORTER_ALLOWLIST = ['src/game/view.ts', 'src/game/renderer.ts', 'src/game/engine.ts', 'src/net/client.ts']
const PIXI_IMPORTER_ALLOWED_DIR = 'src/game/render/'

const isFile = (path: string): boolean => existsSync(path) && statSync(path).isFile()

const listFiles = (dir: string, ext: RegExp): string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((entry) => ext.test(entry))
    .map((entry) => join(dir, entry))

// Comment stripping that tracks string/template state, so a `//` inside a string literal can't
// swallow the rest of its line and a quote inside a comment can't open a phantom string. (Regex
// literals aren't lexed — a `//` inside one eats its own line, which never holds an import.)
const stripComments = (source: string): string => {
  let out = ''
  let i = 0
  let quote: string | undefined
  while (i < source.length) {
    const ch = source[i]
    if (quote !== undefined) {
      out += ch
      if (ch === '\\') {
        out += source[i + 1] ?? ''
        i += 2
        continue
      }
      if (ch === quote) quote = undefined
      i += 1
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    } else if (ch === '/' && source[i + 1] === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    out += ch
    i += 1
  }
  return out
}

// Every static import/export-from/side-effect/dynamic-import/require specifier in a TS source.
// Patterns are unanchored and quote-bounded so several statements on one line are all seen;
// `import X = require()` and bare `require()` count too. Only computed specifiers escape — and
// those can't name pixi.js statically.
const importSpecifiers = (source: string): string[] => {
  const stripped = stripComments(source)
  const specifiers = new Set<string>()
  const patterns = [
    /\b(?:import|export)\b[^;'"`]*?\bfrom\s*['"]([^'"]+)['"]/g, // import x from / export { x } from
    /\bimport\s*['"]([^'"]+)['"]/g, // side-effect import
    /\bimport\s*\(\s*['"`]([^'"`]+)['"`]/g, // dynamic import
    /\brequire\s*\(\s*['"`]([^'"`]+)['"`]/g, // require() / `import X = require()` interop
  ]
  for (const pattern of patterns) {
    for (const match of stripped.matchAll(pattern)) specifiers.add(match[1])
  }
  return [...specifiers]
}

// Resolve a specifier the way the toolchain does: `$/*` → src/* (tsconfig paths), `./`-relative
// against the importer, extensionless → .ts/.tsx/index. Bare package names return undefined
// (external — recorded, not walked). An alias/relative path that resolves to nothing throws, so
// the walk never silently skips an edge.
const resolveSpecifier = (specifier: string, importer: string): string | undefined => {
  const base = specifier.startsWith('$/')
    ? join(SRC, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(importer), specifier)
      : undefined
  if (base === undefined) return undefined
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]
  const hit = candidates.find(isFile)
  if (hit === undefined) {
    throw new Error(`unresolvable import '${specifier}' in ${relative(ROOT, importer)}`)
  }
  return hit
}

type Walk = {
  externals: Map<string, string> // bare package specifier → first repo file importing it
  parents: Map<string, string | undefined> // repo file → the file that pulled it in (chain reporting)
}

const walkImports = (entry: string): Walk => {
  const externals = new Map<string, string>()
  const parents = new Map<string, string | undefined>([[entry, undefined]])
  const visited = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()
    if (file === undefined || visited.has(file)) continue
    visited.add(file)
    if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue
    for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
      const resolved = resolveSpecifier(specifier, file)
      if (resolved === undefined) {
        if (!externals.has(specifier)) externals.set(specifier, file)
        continue
      }
      if (!parents.has(resolved)) parents.set(resolved, file)
      queue.push(resolved)
    }
  }
  return { externals, parents }
}

const importChain = (file: string, parents: Map<string, string | undefined>): string => {
  const chain: string[] = []
  let current: string | undefined = file
  while (current !== undefined) {
    chain.unshift(relative(ROOT, current))
    current = parents.get(current)
  }
  return chain.join(' → ')
}

// Headless entry points: the server entry script, the authoritative server module, the sim
// itself, and every test file (bun test must never boot WebGL).
const HEADLESS_ROOTS = [
  join(ROOT, 'scripts/server.ts'),
  join(SRC, 'server/index.ts'),
  join(SRC, 'game/sim.ts'),
  ...listFiles(join(ROOT, '__tests__'), /\.test\.ts$/),
]

describe('sim/presentation boundary', () => {
  // A missed import form is a silent hole in the boundary — every legal way of pulling in a
  // module must be seen, even ones biome's house style would never produce.
  test('specifier extraction catches every import form', () => {
    expect(importSpecifiers("import { A } from 'a'; import { B } from 'pixi.js'")).toContain('pixi.js')
    expect(importSpecifiers("import { A } from 'a'; import 'pixi.js'")).toContain('pixi.js')
    expect(importSpecifiers("const u = 'a//b'; import('pixi.js')")).toContain('pixi.js')
    expect(importSpecifiers("import P = require('pixi.js')")).toContain('pixi.js')
    expect(importSpecifiers('import(`pixi.js`)')).toContain('pixi.js')
    expect(importSpecifiers("import {\n  Container,\n  Graphics,\n} from 'pixi.js'")).toContain('pixi.js')
    expect(importSpecifiers(`const s = "it's" // import 'nope'\nimport 'pixi.js'`)).toEqual(['pixi.js'])
    expect(importSpecifiers("// import 'pixi.js'\n/* import 'pixi.js' */")).toBeEmpty()
  })

  // Guards the guard: if the walker's parsing rots, this fails before test A goes vacuous.
  test('walker sanity: pixi.js IS reachable from the presentation layer', () => {
    expect(walkImports(join(SRC, 'game/renderer.ts')).externals.has('pixi.js')).toBeTrue()
    // engine.ts only reaches pixi.js transitively (via view/renderer) — proves the walk recurses.
    expect(walkImports(join(SRC, 'game/engine.ts')).externals.has('pixi.js')).toBeTrue()
  })

  test('allowlisted importers exist (no stale entries)', () => {
    for (const file of PIXI_IMPORTER_ALLOWLIST) expect(isFile(join(ROOT, file))).toBeTrue()
  })

  for (const entry of HEADLESS_ROOTS) {
    test(`pixi.js unreachable from ${relative(ROOT, entry)}`, () => {
      const { externals, parents } = walkImports(entry)
      const importer = externals.get('pixi.js')
      const leak = importer === undefined ? undefined : `${importChain(importer, parents)} → pixi.js`
      expect(leak).toBeUndefined()
    })
  }

  test('only the presentation layer imports pixi.js directly', () => {
    const offenders = listFiles(SRC, /\.(ts|tsx)$/)
      .filter((file) => importSpecifiers(readFileSync(file, 'utf8')).includes('pixi.js'))
      .map((file) => relative(ROOT, file))
      .filter((file) => !PIXI_IMPORTER_ALLOWLIST.includes(file) && !file.startsWith(PIXI_IMPORTER_ALLOWED_DIR))
    expect(offenders).toEqual([])
  })
})
