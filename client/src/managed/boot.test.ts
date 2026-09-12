/**
 * The gate, tested apart from the hook it guards — because the hook is the half
 * an install replaces and the gate is the half that stays. What is pinned here is
 * the promise made to a visitor, not a promise made to an operator.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { onAppBoot } = vi.hoisted(() => ({ onAppBoot: vi.fn() }))
vi.mock('./index', () => ({ onAppBoot }))

import { runManagedAppBoot } from './boot'

const touched: string[] = []

function signalDoNotTrack(value: unknown): void {
  Object.defineProperty(navigator, 'doNotTrack', { value, configurable: true, writable: true })
  touched.push('doNotTrack')
}

beforeEach(() => {
  onAppBoot.mockClear()
})

afterEach(() => {
  while (touched.length) Reflect.deleteProperty(navigator, touched.pop()!)
})

describe('runManagedAppBoot', () => {
  it('FE-MANAGED-006: a visitor who said nothing gets the hook the operator attached', () => {
    runManagedAppBoot()
    expect(onAppBoot).toHaveBeenCalledTimes(1)
  })

  it('FE-MANAGED-007: a visitor who set Do Not Track never reaches the hook', () => {
    signalDoNotTrack('1')
    runManagedAppBoot()
    expect(onAppBoot).not.toHaveBeenCalled()
  })

  it('FE-MANAGED-008: the refusal comes first, so nothing is left half-done', () => {
    signalDoNotTrack('1')
    runManagedAppBoot()
    Reflect.deleteProperty(navigator, 'doNotTrack')
    runManagedAppBoot()
    expect(onAppBoot).toHaveBeenCalledTimes(1)
  })
})
