/**
 * mailer.service.test.ts
 *
 * Covers the SMTP transport options MailerService hands to nodemailer, and in
 * particular the skip-TLS opt-out: it must stay reachable for operators behind an
 * internal relay, and it must announce itself instead of downgrading quietly.
 * The second half covers what the admin sees when a send goes wrong (#2196):
 * bounded phases, a classified reason in the response, a line in the log, and
 * the password in neither. The last block covers APP_NAME reaching the mail —
 * the From header, the subject and the mail's own header — and an install that
 * sets nothing getting exactly the mail it got before.
 * Constructed directly (no TestingModule, repo convention).
 */

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  const mock = {
    db,
    closeDb: () => {},
    reinitialize: () => {},
    canAccessTrip: () => undefined,
    isOwner: () => false,
  };
  return { testDb: db, dbMock: mock };
});

const { sendMail, createTransport } = vi.hoisted(() => {
  const send = vi.fn().mockResolvedValue({ messageId: 'test' });
  return {
    sendMail: send,
    createTransport: vi.fn((_options: Record<string, unknown>) => ({ sendMail: send })),
  };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('nodemailer', () => ({ default: { createTransport } }));
vi.mock('../../../src/nest/audit/audit-log.logger', () => ({
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { resetTestDb } from '../../helpers/test-db';
import { MailerService } from '../../../src/nest/notifications/mailer/mailer.service';
import { DatabaseService } from '../../../src/nest/database/database.service';
import { logError, logInfo, logWarn } from '../../../src/nest/audit/audit-log.logger';

function setAppSetting(key: string, value: string): void {
  testDb.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value);
}

/** The minimum that makes getSmtpConfig() return a config instead of null. */
function configureSmtp(): void {
  setAppSetting('smtp_host', 'mail.internal.example');
  setAppSetting('smtp_port', '587');
  setAppSetting('smtp_from', 'trek@example.com');
}

function newMailer(): MailerService {
  return new MailerService(new DatabaseService(testDb));
}

/** The options object of the most recent transport.sendMail() call. */
function lastMail(): Record<string, unknown> {
  const calls = sendMail.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

/** The options object of the most recent nodemailer.createTransport() call. */
function lastTransportOptions(): Record<string, unknown> {
  const calls = createTransport.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  vi.clearAllMocks();
});

afterAll(() => {
  testDb.close();
});

describe('MailerService TLS options', () => {
  it('MAILER-001: leaves certificate verification on by default', async () => {
    configureSmtp();

    expect(await newMailer().sendEmail('someone@example.com', 'Subject', 'Body')).toBe(true);

    expect(lastTransportOptions()).not.toHaveProperty('tls');
    expect(logWarn).not.toHaveBeenCalled();
  });

  it('MAILER-002: the smtp_skip_tls_verify setting turns verification off', async () => {
    configureSmtp();
    setAppSetting('smtp_skip_tls_verify', 'true');

    await newMailer().sendEmail('someone@example.com', 'Subject', 'Body');

    expect(lastTransportOptions().tls).toEqual({ rejectUnauthorized: false });
  });

  it('MAILER-003: anything other than "true" leaves verification on', async () => {
    configureSmtp();
    setAppSetting('smtp_skip_tls_verify', 'false');

    await newMailer().sendEmail('someone@example.com', 'Subject', 'Body');

    expect(lastTransportOptions()).not.toHaveProperty('tls');
    expect(logWarn).not.toHaveBeenCalled();
  });

  it('MAILER-004: skipping verification is announced, and names the host it applies to', async () => {
    configureSmtp();
    setAppSetting('smtp_skip_tls_verify', 'true');

    await newMailer().sendEmail('someone@example.com', 'Subject', 'Body');

    expect(logWarn).toHaveBeenCalledTimes(1);
    const warning = vi.mocked(logWarn).mock.calls[0][0];
    expect(warning).toContain('mail.internal.example:587');
    expect(warning).toContain('SECURITY');
  });

  it('MAILER-005: the warning is logged once per process, not once per mail', async () => {
    configureSmtp();
    setAppSetting('smtp_skip_tls_verify', 'true');
    const mailer = newMailer();

    await mailer.sendEmail('first@example.com', 'One', 'Body');
    await mailer.sendEmail('second@example.com', 'Two', 'Body');
    await mailer.sendPasswordResetEmail('third@example.com', 'https://trek.example/reset', null);

    expect(createTransport).toHaveBeenCalledTimes(3);
    expect(logWarn).toHaveBeenCalledTimes(1);
  });

  it('MAILER-006: a send with no SMTP configured builds no transport at all', async () => {
    expect(await newMailer().sendEmail('someone@example.com', 'Subject', 'Body')).toBe(false);

    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('MAILER-007: connecting and greeting are bounded hard, the transfer is not', async () => {
    configureSmtp();

    await newMailer().sendEmail('someone@example.com', 'Subject', 'Body');

    // Nodemailer's connect and greeting defaults (120s / 30s) outlive the client's
    // 8s API timeout, which is how #2196 produced a failure nobody could read. The
    // inactivity timeout keeps its ten minutes on a real send: it bounds the
    // transfer, a scanning relay can sit on DATA for minutes, and nobody is
    // waiting on the result.
    expect(lastTransportOptions()).toMatchObject({
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 600_000,
    });
  });

  it('MAILER-007b: the admin test send bounds the transfer too, because somebody is waiting', async () => {
    configureSmtp();

    await newMailer().testSmtp('someone@example.com');

    // The client gives this call 40s (CHANNEL_TEST_TIMEOUT), so a relay that
    // accepts the connection and then goes quiet still has to produce a verdict.
    expect(lastTransportOptions()).toMatchObject({
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
  });
});

describe('MailerService test send', () => {
  /** The nodemailer shape: an Error carrying the SMTP code and the relay's reply. */
  function smtpError(message: string, code: string): Error {
    return Object.assign(new Error(message), { code });
  }

  it('MAILER-008: an incomplete configuration names the fields that are missing', async () => {
    setAppSetting('smtp_host', 'mail.internal.example');
    setAppSetting('smtp_port', '587');

    const result = await newMailer().testSmtp('admin@example.com');

    expect(result.success).toBe(false);
    expect(result.error).toContain('SMTP_FROM');
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('MAILER-009: an unusable port is refused before anything reaches a socket', async () => {
    setAppSetting('smtp_host', 'mail.internal.example');
    setAppSetting('smtp_port', 'smtp.example.com');
    setAppSetting('smtp_from', 'trek@example.com');

    const result = await newMailer().testSmtp('admin@example.com');

    expect(result.success).toBe(false);
    expect(result.error).toContain('smtp.example.com');
    expect(result.error).toContain('65535');
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('MAILER-010: a rejected login comes back as a reason, not as a bare failure', async () => {
    configureSmtp();
    sendMail.mockRejectedValueOnce(smtpError('Invalid login: 535 5.7.8 Username and Password not accepted', 'EAUTH'));

    const result = await newMailer().testSmtp('admin@example.com');

    expect(result.success).toBe(false);
    expect(result.error).toContain('rejected the credentials');
    expect(result.error).toContain('535 5.7.8');
  });

  it('MAILER-011: a refused connection is classified and reaches the log with its code', async () => {
    configureSmtp();
    sendMail.mockRejectedValueOnce(smtpError('connect ECONNREFUSED 10.0.0.5:587', 'ESOCKET'));

    const result = await newMailer().testSmtp('admin@example.com');

    expect(result.error).toContain('refused the connection');
    expect(logError).toHaveBeenCalledTimes(1);
    const line = vi.mocked(logError).mock.calls[0][0];
    expect(line).toContain('SMTP test email failed to=admin@example.com');
    expect(line).toContain('smtp=mail.internal.example:587');
    expect(line).toContain('code=ESOCKET');
  });

  it('MAILER-012: a stalled relay is named as a timeout and points at the 465/587 split', async () => {
    setAppSetting('smtp_host', 'mail.internal.example');
    setAppSetting('smtp_port', '465');
    setAppSetting('smtp_from', 'trek@example.com');
    sendMail.mockRejectedValueOnce(smtpError('Greeting never received', 'ETIMEDOUT'));

    const result = await newMailer().testSmtp('admin@example.com');

    expect(result.error).toContain('did not answer in time');
    expect(result.error).toContain('587');
  });

  it('MAILER-013: the password appears in neither the response nor the log', async () => {
    configureSmtp();
    setAppSetting('smtp_user', 'trek@example.com');
    setAppSetting('smtp_pass', 'correct-horse-battery');
    sendMail.mockRejectedValueOnce(smtpError('Invalid login for correct-horse-battery', 'EAUTH'));

    const result = await newMailer().testSmtp('admin@example.com');

    expect(result.error).not.toContain('correct-horse-battery');
    expect(vi.mocked(logError).mock.calls[0][0]).not.toContain('correct-horse-battery');
  });

  it('MAILER-014: a successful test leaves a line in the log naming the relay', async () => {
    configureSmtp();

    expect(await newMailer().testSmtp('admin@example.com')).toEqual({ success: true });

    const lines = vi.mocked(logInfo).mock.calls.map(call => call[0]);
    expect(lines.some(line => line.includes('SMTP test email sent to=admin@example.com smtp=mail.internal.example:587'))).toBe(true);
  });
});

describe('MailerService product name', () => {
  const NAME_VARS = ['APP_NAME', 'MAIL_FROM_NAME'] as const;
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of NAME_VARS) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of NAME_VARS) {
      const prev = saved.get(key);
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  });

  it('MAILER-015: with APP_NAME unset the mail is exactly what it always was', async () => {
    configureSmtp();

    await newMailer().sendEmail('someone@example.com', 'Subject', 'Body');

    expect(lastMail().from).toBe('trek@example.com');
    expect(lastMail().subject).toBe('TREK — Subject');
    expect(lastMail().html).toContain('>TREK</div>');
    expect(lastMail().html).toContain('Travel Resource &amp; Exploration Kit');
  });

  it('MAILER-016: APP_NAME reaches the subject and the From display name', async () => {
    configureSmtp();
    process.env.APP_NAME = 'Acme Trips';

    await newMailer().sendEmail('someone@example.com', 'Subject', 'Body');

    expect(lastMail().from).toEqual({ name: 'Acme Trips', address: 'trek@example.com' });
    expect(lastMail().subject).toBe('Acme Trips — Subject');
  });

  it('MAILER-017: MAIL_FROM_NAME moves only the From name; the subject keeps APP_NAME', async () => {
    configureSmtp();
    process.env.APP_NAME = 'Acme Trips';
    process.env.MAIL_FROM_NAME = 'Acme';

    await newMailer().sendEmail('someone@example.com', 'Subject', 'Body');

    expect(lastMail().from).toEqual({ name: 'Acme', address: 'trek@example.com' });
    expect(lastMail().subject).toBe('Acme Trips — Subject');
  });

  it('MAILER-018: a sender that already spells a display name out is passed through untouched', async () => {
    setAppSetting('smtp_host', 'mail.internal.example');
    setAppSetting('smtp_port', '587');
    setAppSetting('smtp_from', 'Acme Trips <no-reply@acme.example>');
    process.env.APP_NAME = 'Acme Trips';

    await newMailer().sendEmail('someone@example.com', 'Subject', 'Body');

    expect(lastMail().from).toBe('Acme Trips <no-reply@acme.example>');
  });

  it('MAILER-019: a renamed install carries neither the TREK mark nor the acronym', async () => {
    configureSmtp();
    process.env.APP_NAME = 'Acme Trips';

    await newMailer().sendEmail('someone@example.com', 'Subject', 'Body');

    const html = lastMail().html as string;
    expect(html).toContain('>Acme Trips</div>');
    expect(html).not.toContain('Travel Resource &amp; Exploration Kit');
    expect(html).not.toContain('data:image/svg+xml;base64,');
    expect(html).toContain('Open Acme Trips');
    expect(html).toContain('notifications enabled in Acme Trips');
  });

  it('MAILER-020: the password-reset mail names the instance in both the text and the HTML part', async () => {
    configureSmtp();
    process.env.APP_NAME = 'Acme Trips';

    await newMailer().sendPasswordResetEmail('someone@example.com', 'https://acme.example/reset', null);

    expect(lastMail().subject).toBe('Acme Trips — Reset your password');
    expect(lastMail().text).toContain('password for your Acme Trips account');
    expect(lastMail().html).toContain('password for your Acme Trips account');
    expect(lastMail().text).not.toContain('TREK');
  });

  it("MAILER-021: the admin's test send announces the instance, not the product", async () => {
    configureSmtp();
    process.env.APP_NAME = 'Acme Trips';

    expect(await newMailer().testSmtp('admin@example.com')).toEqual({ success: true });

    expect(lastMail().subject).toBe('Acme Trips — Test Notification');
    expect(lastMail().text).toBe(
      'This is a test email from Acme Trips. If you received this, your SMTP configuration is working correctly.',
    );
  });

  it('MAILER-022: a name with HTML metacharacters cannot break out of the header', async () => {
    configureSmtp();
    process.env.APP_NAME = 'A&B <script>';

    await newMailer().sendEmail('someone@example.com', 'Subject', 'Body');

    const html = lastMail().html as string;
    expect(html).toContain('A&amp;B &lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('MAILER-022b: no placeholder survives into the mail a recipient opens', async () => {
    // The failure this catches is a string carrying {appName} down a path that
    // never substitutes it — a literal "{appName}" in somebody's inbox, which
    // is worse than the stale wording the placeholder was meant to fix.
    configureSmtp();
    process.env.APP_NAME = 'Acme Trips';
    const mailer = newMailer();

    await mailer.sendEmail('someone@example.com', 'Subject', 'Body');
    expect(lastMail().html).not.toContain('{appName}');
    expect(lastMail().text).not.toContain('{appName}');

    await mailer.sendPasswordResetEmail('someone@example.com', 'https://acme.example/reset', null);
    expect(lastMail().html).not.toContain('{appName}');
    expect(lastMail().text).not.toContain('{appName}');
    expect(lastMail().subject).not.toContain('{appName}');
  });

  it('MAILER-023: MAIL_FROM_NAME alone adds a display name without renaming anything else', async () => {
    configureSmtp();
    process.env.MAIL_FROM_NAME = 'Acme';

    await newMailer().sendEmail('someone@example.com', 'Subject', 'Body');

    expect(lastMail().from).toEqual({ name: 'Acme', address: 'trek@example.com' });
    expect(lastMail().subject).toBe('TREK — Subject');
  });
});
