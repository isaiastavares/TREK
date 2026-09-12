import { prefersNoTracking } from '../utils/doNotTrack'
import { onAppBoot } from './index'

/**
 * The one call into the managed boot hook, and the refusal in front of it.
 *
 * This file is deliberately NOT the attachment point — `index.tsx` is. An install
 * replaces that file at build time and this one stays, which is what makes the
 * sentence below a guarantee rather than a request: a visitor who set Do Not
 * Track or Global Privacy Control does not reach `onAppBoot`, whatever an
 * operator put behind it.
 *
 * The order matters. Reading the signal first and returning costs one property
 * lookup and leaves nothing to undo; calling first and asking afterwards would
 * mean a script already loaded and a request already sent by the time the answer
 * arrived.
 */
export function runManagedAppBoot(): void {
  if (prefersNoTracking()) return
  onAppBoot()
}
