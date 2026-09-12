/**
 * The visitor's "do not track me" signal, read in one place.
 *
 * Four spellings for one answer, because the flag was standardised, deprecated
 * and replaced while browsers kept shipping all of it. `globalPrivacyControl` is
 * the one with legal force behind it in some jurisdictions; `navigator.doNotTrack`
 * is the surviving DNT spelling; `window.doNotTrack` and `navigator.msDoNotTrack`
 * are older placements still answered by browsers people use. Firefox says `'1'`,
 * some builds said `'yes'`, GPC says `true` — all the same sentence.
 *
 * Silence is not consent and it is not refusal: an unset flag means the visitor
 * never said anything, and this function returns false for it. What it promises
 * is narrower and worth more — that a visitor who *did* speak is heard, wherever
 * they happened to say it.
 */

type PrivacyNavigator = Navigator & {
  globalPrivacyControl?: unknown
  msDoNotTrack?: unknown
}

/** `'1'`, `'yes'` and `true` are the three ways the browsers in the wild say yes. */
function meansOptOut(value: unknown): boolean {
  return value === '1' || value === 'yes' || value === true
}

export function prefersNoTracking(): boolean {
  const nav = navigator as PrivacyNavigator
  return (
    meansOptOut(nav.globalPrivacyControl) ||
    meansOptOut(nav.doNotTrack) ||
    meansOptOut((window as Window & { doNotTrack?: unknown }).doNotTrack) ||
    meansOptOut(nav.msDoNotTrack)
  )
}
