// The app's version, single-sourced from package.json so the title screen, the build's PWA
// layer, and the release script never drift apart. The `release` script bumps package.json
// and every surface follows.
import { version } from '../package.json'

export const APP_VERSION: string = version
