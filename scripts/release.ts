// Cut a new release with git-flow, mirroring this repo's convention: start a release branch off
// develop, bump package.json ("Version bump <version>"), then `git flow release finish` to merge
// into main, tag the bare version, and back-merge into develop. package.json is the single source
// of the version every other surface reads (the title screen via src/version.ts, the PWA manifest
// + head metadata via scripts/pwa/identity.ts), so bumping it here updates them all on next build.
//
// The GitHub Release itself is published by CI: pushing the bare-semver tag fires
// .github/workflows/release.yml, which builds the bundle and runs `gh release create`. So a
// release is "done" once `--push` lands the tag on origin (that same push also redeploys the
// Pages demo via deploy-demo.yml). Without --push nothing leaves your machine.
//
//   bun run release patch              # 0.4.1 → 0.4.2 (local cut only)
//   bun run release minor              # 0.4.1 → 0.5.0 (local cut only)
//   bun run release major --yes        # 1.0.0, skip the confirmation prompt
//   bun run release patch --push       # cut, then push main+develop+tag → triggers the GitHub Release
//   bun run release patch --dry-run    # print the plan + any blockers, change nothing

import { join, resolve } from 'node:path'
import { $ } from 'bun'

const BUMPS = ['major', 'minor', 'patch'] as const
type Bump = (typeof BUMPS)[number]

const KNOWN_FLAGS = new Set(['--dry-run', '--yes', '--push', '--help', '-h'])

const USAGE = 'usage: bun run release <major|minor|patch> [--dry-run] [--yes] [--push]'

const ROOT = resolve(import.meta.dir, '..')
const PKG = join(ROOT, 'package.json')

const die = (message: string): never => {
  console.error(`✗ ${message}`)
  process.exit(1)
}

// Bump a plain `major.minor.patch` string; patch/minor zero the lower fields as semver dictates.
const nextVersion = (current: string, bump: Bump): string => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current)
  if (!match) throw new Error(`package.json version is not plain semver: "${current}"`)
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

// Trimmed stdout of a git command; never throws (a non-zero exit just yields '').
const git = async (...command: string[]): Promise<string> =>
  (await $`git ${command}`.cwd(ROOT).quiet().nothrow()).stdout.toString().trim()

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE)
    return
  }
  const flags = argv.filter((arg) => arg.startsWith('-'))
  const unknown = flags.filter((flag) => !KNOWN_FLAGS.has(flag))
  if (unknown.length > 0) die(`unknown flag${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}\n${USAGE}`)
  const positionals = argv.filter((arg) => !arg.startsWith('-'))
  const dryRun = flags.includes('--dry-run')
  const autoYes = flags.includes('--yes')
  const push = flags.includes('--push')

  const bump = positionals[0]
  if (!bump || !(BUMPS as readonly string[]).includes(bump)) die(USAGE)

  const pkg = JSON.parse(await Bun.file(PKG).text()) as { version: string }
  const current = pkg.version
  const version = nextVersion(current, bump as Bump)

  // git-flow respects configurable branch names; fall back to the conventional pair.
  const developBranch = (await git('config', 'gitflow.branch.develop')) || 'develop'
  const masterBranch = (await git('config', 'gitflow.branch.master')) || 'main'
  const branch = await git('rev-parse', '--abbrev-ref', 'HEAD')
  const dirty = (await git('status', '--porcelain')) !== ''
  const tagExists = (await git('tag', '--list', version)) === version
  const hasGitFlow = (await $`git flow version`.cwd(ROOT).quiet().nothrow()).exitCode === 0

  const blockers: string[] = []
  if (!hasGitFlow) blockers.push('git-flow is not installed (need the AVH edition — `git flow version`)')
  if (branch !== developBranch)
    blockers.push(`must be on "${developBranch}" to start a release (currently on "${branch}")`)
  if (dirty) blockers.push('working tree has uncommitted changes — commit or stash them first')
  if (tagExists) blockers.push(`tag "${version}" already exists`)

  console.log('V-Wing release')
  console.log(`  bump:    ${bump}`)
  console.log(`  version: ${current} → ${version}`)
  console.log(`  flow:    ${developBranch} → release/${version} → ${masterBranch} (tag ${version}) → ${developBranch}`)

  if (dryRun) {
    console.log('\nWould run:')
    console.log(`  git flow release start ${version}`)
    console.log(`  (write package.json version → ${version})`)
    console.log(`  git commit -m "Version bump ${version}" package.json`)
    console.log(`  git flow release finish -m "${version}" ${version}`)
    if (push) {
      console.log(`  git push origin ${masterBranch} ${developBranch} && git push origin ${version}`)
      console.log(`  → the tag push fires .github/workflows/release.yml, which publishes the GitHub Release`)
    }
    if (blockers.length > 0) {
      console.log('\nBlockers (these would abort a real run):')
      for (const blocker of blockers) console.log(`  - ${blocker}`)
    } else {
      console.log('\nNo blockers — a real run would proceed after confirmation.')
    }
    return
  }

  if (blockers.length > 0) {
    for (const blocker of blockers) console.error(`✗ ${blocker}`)
    process.exit(1)
  }

  if (!autoYes) {
    if (!process.stdin.isTTY) die('no TTY for the confirmation prompt — re-run with --yes to release non-interactively')
    const answer = prompt(`\nRelease ${version}? [y/N]`)
    if (!answer || !/^y(es)?$/i.test(answer.trim())) die('aborted — nothing changed')
  }

  // Keep git-flow's auto-generated merge commits from opening an editor (matches the existing
  // "Merge branch 'release/x'" / "Merge tag 'x' into develop" history).
  process.env.GIT_MERGE_AUTOEDIT = 'no'

  try {
    await $`git flow release start ${version}`.cwd(ROOT)
    pkg.version = version
    // Re-stringify with the original 2-space indent + trailing newline so the diff is just the
    // version line (JSON.parse/stringify preserves key order for string keys).
    await Bun.write(PKG, `${JSON.stringify(pkg, undefined, 2)}\n`)
    await $`git commit -m ${`Version bump ${version}`} package.json`.cwd(ROOT)
    await $`git flow release finish -m ${version} ${version}`.cwd(ROOT)
    if (push) {
      await $`git push origin ${masterBranch} ${developBranch}`.cwd(ROOT)
      await $`git push origin ${version}`.cwd(ROOT)
    }
  } catch (cause) {
    console.error(`\n✗ release failed: ${(cause as Error).message}`)
    console.error(
      `  a "release/${version}" branch may be half-finished — inspect with \`git status\` / \`git flow release\` and finish or delete it by hand.`
    )
    process.exit(1)
  }

  if (push) {
    console.log(`\n✓ released ${version} and pushed — release.yml is now publishing the GitHub Release`)
    console.log(`  watch it with: gh run watch — then: gh release view ${version}`)
  } else {
    console.log(`\n✓ cut ${version} locally — not pushed, so no GitHub Release yet`)
    console.log(
      `  to publish: git push origin ${masterBranch} ${developBranch} && git push origin ${version}  (the tag push triggers release.yml)`
    )
  }
}

await main()
