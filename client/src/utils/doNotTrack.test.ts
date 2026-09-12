/**
 * The signal has four spellings and three truthy values, and the only thing worse
 * than missing one is inventing one: a false positive here silently turns off a
 * seam the operator configured, with nothing in the console to say why.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { prefersNoTracking } from './doNotTrack'

const touched: Array<{ target: object; key: string }> = []

function set(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, configurable: true, writable: true })
  touched.push({ target, key })
}

afterEach(() => {
  while (touched.length) {
    const { target, key } = touched.pop()!
    Reflect.deleteProperty(target, key)
  }
})

describe('prefersNoTracking', () => {
  it('FE-DNT-001: silence is not an opt-out', () => {
    expect(prefersNoTracking()).toBe(false)
  })

  it.each([
    ['navigator.doNotTrack', navigator, 'doNotTrack'],
    ['window.doNotTrack', window, 'doNotTrack'],
    ['navigator.msDoNotTrack', navigator, 'msDoNotTrack'],
  ])('FE-DNT-002: %s set to "1" is heard', (_label, target, key) => {
    set(target, key, '1')
    expect(prefersNoTracking()).toBe(true)
  })

  it('FE-DNT-003: the browsers that answer "yes" instead of "1" are heard too', () => {
    set(navigator, 'doNotTrack', 'yes')
    expect(prefersNoTracking()).toBe(true)
  })

  it('FE-DNT-004: Global Privacy Control is a boolean, not a string', () => {
    set(navigator, 'globalPrivacyControl', true)
    expect(prefersNoTracking()).toBe(true)
  })

  it.each([['0'], ['unspecified'], ['null'], ['']])(
    'FE-DNT-005: %o is a visitor who did not opt out',
    (value) => {
      set(navigator, 'doNotTrack', value)
      expect(prefersNoTracking()).toBe(false)
    },
  )

  it('FE-DNT-006: globalPrivacyControl false is not an opt-out', () => {
    set(navigator, 'globalPrivacyControl', false)
    expect(prefersNoTracking()).toBe(false)
  })

  it('FE-DNT-007: one signal is enough, whichever of them it is', () => {
    set(navigator, 'doNotTrack', '0')
    set(navigator, 'msDoNotTrack', '1')
    expect(prefersNoTracking()).toBe(true)
  })
})
