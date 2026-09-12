/**
 * app-name.surfaces.test.ts
 *
 * APP_NAME exists so the product name lives in one place instead of the dozens
 * of literals it used to be. That is only true if every surface that announces
 * this install to somebody else actually reads it, so this suite walks them:
 * the outbound User-Agent, the PRODID of a downloaded calendar, the creator of
 * a downloaded GPX, the OpenAPI title, the MCP server's name and the first
 * sentence every AI client reads.
 *
 * Both directions matter equally. Unset, each surface must emit the exact bytes
 * it emitted before this variable existed — an upgrade that quietly changes the
 * User-Agent an install sends to OpenStreetMap, or the PRODID inside calendars
 * already subscribed to, is the failure mode worth pinning.
 *
 * The mail surfaces live in mailer.service.test.ts, next to the rest of the
 * mailer; buildUserAgent's URL rules stay in maps.service.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { getMcpServerName, serverUserAgent, withAppName, readEnv } from '../../../src/app-config';
import { buildUserAgent } from '../../../src/nest/maps/maps.helpers';
import { calendarHeader } from '../../../src/nest/calendar/calendar.service';
import { buildGpx } from '../../../src/nest/places/gpx-export.helpers';
import { buildMcpInstructions, staticTokenDeprecationNotice } from '../../../src/nest/mcp-transport/mcp-transport.constants';
import { buildWebhookBody } from '../../../src/nest/notifications/transports/webhook.service';
import { getEventText } from '../../../src/nest/notifications/mailer/email-html';
import { EVENT_TEXTS } from '@trek/shared/i18n/externalNotifications';
import { describeSmtpFailure } from '../../../src/nest/notifications/mailer/smtp-diagnostics';

/** The smallest input buildGpx writes a file for — it returns null for an empty trip. */
function oneWaypointTrip(): Parameters<typeof buildGpx>[0] {
  return {
    tripTitle: 'Trip',
    places: [
      {
        name: 'Somewhere', description: null, address: null,
        lat: 48.8566, lng: 2.3522, route_geometry: null, category: null,
      },
    ],
    days: [],
  };
}

/** The three webhook shapes are picked by URL, so the URL is the fixture. */
const DISCORD = 'https://discord.com/api/webhooks/1/abc';
const SLACK = 'https://hooks.slack.com/services/T/B/x';
const EVENT = { event: 'trip_reminder', title: 'Title', body: 'Body', link: 'https://acme.example/trip/1' };

/** Enough params that no event text throws; the wording is what is under test. */
const PARAMS = { actor: 'A', trip: 'T', invitee: 'B', count: '1', version: '1.0.0', booking: 'B', type: 't', todo: 'x', due: 'd', category: 'c', preview: 'p', backend: 'b', op: 'o', key: 'k', error: 'e', suppressed: '0', title: 'T', body: 'B' };

/** An unreachable relay — the branch of describeSmtpFailure that names the container. */
const TARGET = { host: 'mail.example', port: 587, secure: false };

function discordFooter(json: string): string {
  return (JSON.parse(json) as { embeds: Array<{ footer: { text: string } }> }).embeds[0].footer.text;
}

let previous: string | undefined;

beforeEach(() => {
  previous = process.env.APP_NAME;
  delete process.env.APP_NAME;
});

afterEach(() => {
  if (previous === undefined) delete process.env.APP_NAME;
  else process.env.APP_NAME = previous;
});

/** What a deployment that renamed itself sets. */
function rename(to = 'Acme Trips'): void {
  process.env.APP_NAME = to;
}

describe('APP_NAME unset — every surface keeps the bytes it always had', () => {
  it('APPNAME-001: the outbound User-Agent is unchanged', () => {
    expect(buildUserAgent(readEnv().app.appName, undefined)).toBe(
      'TREK Travel Planner (https://github.com/liketrek/TREK)',
    );
    expect(serverUserAgent()).toBe('TREK-Server');
  });

  it('APPNAME-002: the VCALENDAR preamble is byte-for-byte the legacy one', () => {
    expect(calendarHeader()).toBe(
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//TREK//Travel Planner//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n',
    );
  });

  it('APPNAME-003: a downloaded GPX still names TREK as its creator', () => {
    expect(buildGpx(oneWaypointTrip())).toContain('creator="TREK"');
  });

  it('APPNAME-004: the MCP server name and the session instructions are unchanged', () => {
    expect(getMcpServerName()).toBe('TREK MCP');
    expect(buildMcpInstructions()).toContain('You are connected to TREK, a travel planning application.');
    expect(staticTokenDeprecationNotice()).toContain('Your TREK integration is using a static API token');
  });

  it('APPNAME-004b: an outgoing webhook still names TREK as its source', () => {
    const generic = JSON.parse(buildWebhookBody('https://hooks.example/x', EVENT)) as { source: string };
    expect(generic.source).toBe('TREK');
    expect(JSON.parse(buildWebhookBody(SLACK, EVENT)).text).toContain('Open in TREK');
    expect(discordFooter(buildWebhookBody(DISCORD, EVENT))).toBe('TREK');
  });

  it('APPNAME-004c: notification text and the SMTP diagnostic still say TREK', () => {
    expect(getEventText('en', 'vacay_invite', { actor: 'Ada' }).body).toContain('Open TREK to accept or decline');
    expect(describeSmtpFailure(Object.assign(new Error('connect EHOSTUNREACH'), { code: 'ESOCKET' }), TARGET, '').reason).toContain('the TREK container');
  });

  it('APPNAME-005: spelling the default out changes nothing either', () => {
    rename('TREK');
    expect(getMcpServerName()).toBe('TREK MCP');
    expect(calendarHeader()).toContain('PRODID:-//TREK//Travel Planner//EN');
    expect(readEnv().app.isDefaultAppName).toBe(true);
  });
});

describe('APP_NAME set — the install announces itself under its own name', () => {
  it('APPNAME-006: the outbound User-Agent identifies the instance, not the product', () => {
    rename();
    expect(buildUserAgent(readEnv().app.appName, undefined)).toBe(
      'Acme Trips Travel Planner (https://github.com/liketrek/TREK)',
    );
    expect(serverUserAgent()).toBe('Acme Trips-Server');
  });

  it('APPNAME-007: the PRODID of every downloaded or subscribed calendar follows', () => {
    rename();
    expect(calendarHeader()).toBe(
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Acme Trips//Travel Planner//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n',
    );
  });

  it('APPNAME-008: a name carrying RFC 5545 specials is escaped, not emitted raw', () => {
    // Unescaped, the semicolon ends the property value and every following line
    // of the .ics is read as part of a parameter — the whole file is unusable.
    rename('Acme; Trips, Ltd');
    const header = calendarHeader();
    expect(header).toContain(String.raw`PRODID:-//Acme\; Trips\, Ltd//Travel Planner//EN`);
    // Five properties and the trailing CRLF: nothing leaked into a new line.
    expect(header.split('\r\n')).toHaveLength(6);
  });

  it('APPNAME-009: the GPX creator follows', () => {
    rename();
    expect(buildGpx(oneWaypointTrip())).toContain('creator="Acme Trips"');
  });

  it('APPNAME-010: the MCP server has one name, and all four surfaces read it from here', () => {
    rename();
    expect(getMcpServerName()).toBe('Acme Trips MCP');
  });

  it('APPNAME-010b: an outgoing webhook says who is writing, on all three shapes', () => {
    rename();
    expect(JSON.parse(buildWebhookBody('https://hooks.example/x', EVENT)).source).toBe('Acme Trips');
    expect(JSON.parse(buildWebhookBody(SLACK, EVENT)).text).toContain('Open in Acme Trips');
    expect(discordFooter(buildWebhookBody(DISCORD, EVENT))).toBe('Acme Trips');
  });

  it('APPNAME-010c: a notification names the instance on every channel it reaches', () => {
    rename();
    // getEventText is the one entry point NotificationsService uses for the
    // email, the in-app row and the push payload alike.
    expect(getEventText('en', 'vacay_invite', { actor: 'Ada' }).body).toContain('Open Acme Trips to accept or decline');
    expect(getEventText('de', 'collection_invite', { actor: 'Ada' }).body).toContain('Acme Trips');
    expect(describeSmtpFailure(Object.assign(new Error('connect EHOSTUNREACH'), { code: 'ESOCKET' }), TARGET, '').reason).toContain('the Acme Trips container');
  });

  it('APPNAME-011: the first sentence every AI client reads names the instance', () => {
    rename();
    const instructions = buildMcpInstructions();
    expect(instructions).toContain('You are connected to Acme Trips, a travel planning application.');
    expect(instructions).toContain('may not be available on every Acme Trips instance');
    expect(instructions).not.toContain('TREK');
    expect(staticTokenDeprecationNotice()).not.toContain('TREK');
  });
});

describe('no placeholder reaches a reader', () => {
  it('APPNAME-014: every event text resolves, in every locale and every event', () => {
    rename();
    const events = Object.keys(EVENT_TEXTS.en) as Array<keyof (typeof EVENT_TEXTS)['en']>;
    const leaked: string[] = [];
    for (const locale of Object.keys(EVENT_TEXTS)) {
      for (const event of events) {
        const { title, body } = getEventText(locale, event as never, PARAMS);
        if (title.includes('{appName}') || body.includes('{appName}')) leaked.push(`${locale}.${event}`);
      }
    }
    expect(leaked).toEqual([]);
  });
});

describe('withAppName', () => {
  it('APPNAME-012: substitutes every occurrence, and leaves text without the placeholder alone', () => {
    expect(withAppName('Open {appName} to accept', 'Acme')).toBe('Open Acme to accept');
    expect(withAppName('{appName} — {appName}', 'Acme')).toBe('Acme — Acme');
    // A locale that still spells the name out renders stale wording, not a crash.
    expect(withAppName('Open TREK to accept', 'Acme')).toBe('Open TREK to accept');
  });

  it('APPNAME-013: reads the live name when none is passed', () => {
    expect(withAppName('Open {appName}')).toBe('Open TREK');
    rename();
    expect(withAppName('Open {appName}')).toBe('Open Acme Trips');
  });
});
