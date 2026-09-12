import ar from './ar/externalNotifications';
import br from './br/externalNotifications';
import ca from './ca/externalNotifications';
import cs from './cs/externalNotifications';
import de from './de/externalNotifications';
import en from './en/externalNotifications';
import es from './es/externalNotifications';
import type { NotificationLocale } from './externalNotifications/types';
import fr from './fr/externalNotifications';
import gr from './gr/externalNotifications';
import hu from './hu/externalNotifications';
import id from './id/externalNotifications';
import itIT from './it/externalNotifications';
import ja from './ja/externalNotifications';
import ko from './ko/externalNotifications';
import nl from './nl/externalNotifications';
import pl from './pl/externalNotifications';
import ru from './ru/externalNotifications';
import sv from './sv/externalNotifications';
import tr from './tr/externalNotifications';
import uk from './uk/externalNotifications';
import vi from './vi/externalNotifications';
import zh from './zh/externalNotifications';
import zhTW from './zh-TW/externalNotifications';

import { describe, it, expect } from 'vitest';

/**
 * The external-notification strings that name the install carry `{appName}`,
 * resolved by the server at render time (app-config's withAppName).
 *
 * Two failures this guards against, and neither is visible to the file-set
 * parity check next door. A translation that spells the product out instead of
 * keeping the placeholder silently says TREK on an install called something
 * else — the bug the placeholder exists to prevent. And a placeholder typo
 * (`{appname}`, `{nomeApp}`) renders literally in somebody's inbox, which is
 * worse than the stale wording it was meant to fix.
 *
 * `en` drives the list: whichever of its strings carry the placeholder are the
 * ones every other locale must carry it in too.
 */
const LOCALES: Record<string, NotificationLocale> = {
  ar, br, ca, cs, de, es, fr, gr, hu, id, it: itIT, ja, ko, nl, pl, ru, sv, tr, uk, vi, zh, 'zh-TW': zhTW,
};

const PLACEHOLDER = '{appName}';
/** Params are irrelevant here — only the surrounding wording is under test. */
const PARAMS = { actor: 'A', trip: 'T', invitee: 'B', count: '1', version: '1.0.0' };

/** Every translatable string of one locale, keyed by where it lives. */
function flatten(locale: NotificationLocale): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(locale.email)) out[`email.${key}`] = value;
  for (const [key, value] of Object.entries(locale.passwordReset)) out[`passwordReset.${key}`] = value;
  for (const [event, fn] of Object.entries(locale.events)) {
    const { title, body } = fn(PARAMS);
    out[`events.${event}.title`] = title;
    out[`events.${event}.body`] = body;
  }
  return out;
}

const EN = flatten(en);
const KEYS_WITH_PLACEHOLDER = Object.entries(EN)
  .filter(([, value]) => value.includes(PLACEHOLDER))
  .map(([key]) => key);

describe('external notifications: the {appName} placeholder', () => {
  it('I18N-APPNAME-001: en marks every string that names the install', () => {
    // A canary: if this set ever empties, the placeholder was removed from the
    // canonical locale and every assertion below would pass vacuously.
    expect(KEYS_WITH_PLACEHOLDER.length).toBeGreaterThan(0);
  });

  it('I18N-APPNAME-002: every locale keeps the placeholder where en has one', () => {
    const violations: string[] = [];
    for (const [name, locale] of Object.entries(LOCALES)) {
      const strings = flatten(locale);
      for (const key of KEYS_WITH_PLACEHOLDER) {
        const translated = strings[key];
        if (typeof translated !== 'string') continue;
        if (!translated.includes(PLACEHOLDER)) violations.push(`${name} ${key}: ${JSON.stringify(translated)}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('I18N-APPNAME-003: no locale invents a placeholder the server does not substitute', () => {
    const orphans: string[] = [];
    for (const [name, locale] of Object.entries({ en, ...LOCALES })) {
      for (const [key, value] of Object.entries(flatten(locale))) {
        for (const found of value.match(/\{[a-zA-Z0-9_]+\}/g) ?? []) {
          if (found !== PLACEHOLDER) orphans.push(`${name} ${key}: ${found}`);
        }
      }
    }
    expect(orphans).toEqual([]);
  });
});
