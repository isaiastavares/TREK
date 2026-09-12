/**
 * The attachment point is empty here, and the filter over it is the one piece of
 * logic it does carry — so it is the one piece worth testing.
 *
 * The emptiness matters on its own: this is the seam where an install can attach
 * its own screens, and the promise to everyone else is that a build of this
 * repository carries none of them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Briefcase } from 'lucide-react'
import {
  managedAdminTabs,
  managedNavItems,
  managedRoutes,
  onAppBoot,
  visibleManagedNavItems,
  type ManagedNavItem,
} from './index'

describe('managed attachment point', () => {
  it('FE-MANAGED-001: ships empty, so the public build registers nothing', () => {
    expect(managedRoutes).toEqual([])
    expect(managedNavItems).toEqual([])
    expect(managedAdminTabs).toEqual([])
  })

  it('FE-MANAGED-002: an empty list stays empty for either kind of user', () => {
    // The nav bars call this unconditionally. If it ever returned anything here,
    // every install would grow an entry nobody asked for.
    expect(visibleManagedNavItems(true)).toEqual([])
    expect(visibleManagedNavItems(false)).toEqual([])
  })
})

describe('visibleManagedNavItems', () => {
  const item = (over: Partial<ManagedNavItem>): ManagedNavItem => ({
    id: 'x',
    path: '/x',
    label: 'X',
    Icon: Briefcase,
    ...over,
  })

  // The function is exported and takes its list implicitly, so exercise the rule
  // directly rather than mutating the module constant.
  const apply = (items: ManagedNavItem[], isAdmin: boolean) =>
    items.filter((i) => !i.adminOnly || isAdmin).map((i) => i.id)

  it('FE-MANAGED-003: an adminOnly entry is offered to an admin and nobody else', () => {
    const items = [item({ id: 'billing', adminOnly: true })]
    expect(apply(items, true)).toEqual(['billing'])
    expect(apply(items, false)).toEqual([])
  })

  it('FE-MANAGED-004: without the flag an entry is for everyone', () => {
    // Absent means "for everyone", not "for nobody" — a missing flag must not
    // silently hide a screen somebody attached on purpose.
    const items = [item({ id: 'open' }), item({ id: 'explicit', adminOnly: false })]
    expect(apply(items, false)).toEqual(['open', 'explicit'])
  })

  it('FE-MANAGED-005: mixed lists keep their order', () => {
    const items = [item({ id: 'a' }), item({ id: 'b', adminOnly: true }), item({ id: 'c' })]
    expect(apply(items, true)).toEqual(['a', 'b', 'c'])
    expect(apply(items, false)).toEqual(['a', 'c'])
  })
})

/**
 * "TREK sends no telemetry" is a sentence in package.json, and this is the test
 * that keeps it true through the one seam built for an operator who wants their
 * own. It watches every door out of a browser tab rather than the hook itself:
 * what matters is not that the function body is empty today, it is that nothing
 * leaves when it runs.
 */
describe('onAppBoot in a build of this repository', () => {
  const restore: Array<() => void> = []

  function watch<T extends object, K extends keyof T>(target: T, key: K) {
    const spy = vi.fn()
    const original = target[key]
    Object.defineProperty(target, key, { value: spy, configurable: true, writable: true })
    restore.push(() => Object.defineProperty(target, key, { value: original, configurable: true, writable: true }))
    return spy
  }

  afterEach(() => {
    while (restore.length) restore.pop()!()
  })

  it('FE-MANAGED-009: is inert — it returns nothing and opens nothing', () => {
    const fetchSpy = watch(window, 'fetch')
    const xhrSpy = watch(XMLHttpRequest.prototype, 'open')
    const beaconSpy = watch(navigator as Navigator & { sendBeacon: unknown }, 'sendBeacon')
    const appendSpy = watch(Element.prototype, 'appendChild')

    expect(onAppBoot()).toBeUndefined()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrSpy).not.toHaveBeenCalled()
    expect(beaconSpy).not.toHaveBeenCalled()
    expect(appendSpy).not.toHaveBeenCalled()
  })
})
