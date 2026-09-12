# Observability

TREK sends no telemetry. Nothing on this page is on by default, and nothing here makes TREK report to us — every
mechanism below is something **you** turn on, pointed at a collector **you** run or pay for.

That distinction is the whole design. A self-hosted install that nobody configured makes no request it was not asked
to make, and there is a test in the client suite that fails if the one extension point described below ever stops
being inert.

---

## What you already have

| | Where | Notes |
|---|---|---|
| Application log | `/app/data/logs/trek.log` in the container | Verbosity via `LOG_LEVEL` (`error`/`warn`/`info`/`debug`) |
| Health endpoint | `GET /api/health` | Unauthenticated, cheap, and what the image's own `HEALTHCHECK` calls |
| Audit trail | Admin → Audit Log | Who did what, including every MCP tool invocation — see [Audit-Log](Audit-Log) |

For many instances that is the whole answer. The rest of this page is for operators who need traces, error grouping
or product analytics on top.

---

## Traces and errors (OpenTelemetry)

**TREK ships no OpenTelemetry packages and reads no `OTEL_*` variable itself.** It does not need to.

OpenTelemetry's zero-code instrumentation attaches to a Node process from the outside: it is loaded before the
application, patches `http`, `express` and the database driver as they are required, and needs no cooperation from the
code it is measuring. The container's entrypoint is a plain `node` invocation, so `NODE_OPTIONS` reaches it and the
standard `OTEL_*` variables work exactly as the specification describes them.

The one thing you have to solve yourself is packaging: the official image deliberately ships without npm, so you
cannot install anything into a running container. Build a derived image instead.

```dockerfile
# Stage 1 — resolve the instrumentation packages somewhere with npm available.
FROM node:24-trixie-slim AS otel
WORKDIR /otel
RUN npm init -y \
 && npm install --omit=dev @opentelemetry/api @opentelemetry/auto-instrumentations-node

# Stage 2 — your TREK image, plus the loader.
FROM mauriceboe/trek:latest
COPY --from=otel --chown=node:node /otel /otel
COPY --chown=node:node register.js /otel/register.js
ENV NODE_OPTIONS="--require /otel/register.js"
```

`register.js`, kept next to the `Dockerfile`:

```js
// The app runs with its CWD in /app/server, so a bare specifier would never find
// /otel/node_modules. Resolve from /otel explicitly and let the package do the rest.
const { createRequire } = require('node:module')
createRequire('/otel/')('@opentelemetry/auto-instrumentations-node/register')
```

Then configure it the standard way — these are OpenTelemetry's variables, not TREK's, and the specification is the
reference for all of them:

| Variable | What it does |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Where spans go. **Nothing is exported until this is set.** |
| `OTEL_EXPORTER_OTLP_HEADERS` | Auth for that endpoint, e.g. `x-api-key=…` |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` (usual) or `grpc` |
| `OTEL_SERVICE_NAME` | The name your backend files the traces under |
| `OTEL_RESOURCE_ATTRIBUTES` | Extra resource tags, e.g. `deployment.environment=staging` |
| `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG` | Sampling — a busy instance does not need every span |
| `OTEL_NODE_DISABLED_INSTRUMENTATIONS` | Turn individual instrumentations off, e.g. `fs` |
| `OTEL_LOG_LEVEL` | `debug` while you are working out why nothing arrives |

Both Sentry and PostHog accept OTLP directly, so "which backend" is a question about
`OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` and nothing else.

> **Read your spans before you ship them anywhere shared.** HTTP instrumentation records request paths, and TREK's
> paths carry trip, user and file ids. `/mcp` and the OAuth routes carry bearer tokens in headers. A collector you do
> not control is a copy of that data you cannot delete — sample narrowly, strip what you do not need, and prefer a
> collector inside your own perimeter.

> **Instrument the process, not the image, if you can.** If you already run an OpenTelemetry Collector as a sidecar,
> point `OTEL_EXPORTER_OTLP_ENDPOINT` at it rather than at a vendor, and keep the credentials out of the container
> that serves your users.

---

## Error reporting without OpenTelemetry

The same trick works for an error reporter with its own SDK, and is usually less to configure. Build the derived image
the same way, with an `instrument.js` that initialises the SDK before anything else loads:

```js
// /otel/register.js — same NODE_OPTIONS, different payload.
const { createRequire } = require('node:module')
const requireFrom = createRequire('/otel/')
requireFrom('@sentry/node').init({
  dsn: process.env.ERROR_REPORTING_DSN,
  environment: process.env.NODE_ENV,
})
```

`ERROR_REPORTING_DSN` there is **your** variable, read by **your** loader — TREK does not know the name and does not
look for it. Leave it unset and the SDK initialises with no DSN and sends nothing, which is the same off-by-default
shape as everything else here. The DSN format is also spoken by self-hosted Sentry, GlitchTip and Bugsink, so this
does not tie you to a vendor either.

---

## The browser half

The server side above never touches the client bundle, and the client is the harder half — on purpose.

TREK serves its own frontend under a strict Content-Security-Policy: `script-src 'self'`, and a `connect-src` that is
an explicit allow-list of the map, weather and routing hosts the app ships with. A third-party analytics snippet
pasted into the page is blocked by the browser, silently, and adding your vendor to that policy is not something an
environment variable can do.

What exists instead is a build-time attachment point, for an operator who builds their own client:

- **`client/src/managed/index.tsx` exports `onAppBoot()`**, called once at startup, before the app renders. It is
  empty in this repository and does nothing.
- An install that needs a boot hook **replaces that file at build time**, the same way it already can for extra
  routes, navigation entries and admin tabs.
- **`client/src/managed/boot.ts` is the gate in front of it, and it is not part of what you replace.** A visitor whose
  browser sends Do Not Track or Global Privacy Control never reaches `onAppBoot` at all. That is TREK's code, it stays
  in your build, and it is checked by its own test.

Two consequences worth planning for:

- **Bundle the SDK, do not script-tag it.** `import`ing `posthog-js` or `@sentry/browser` into your replaced file
  makes it part of your own bundle, served from your own origin, which `script-src 'self'` already allows.
- **Send through your own origin.** Both PostHog (reverse proxy) and Sentry (`tunnel`) document a first-party ingest
  path, which `connect-src 'self'` already allows — and which ad blockers do not strip. Pointing straight at a vendor
  hostname means editing the CSP, which means patching the server too.

---

## Related Pages

- [Environment-Variables](Environment-Variables) — the variables TREK itself reads
- [Audit-Log](Audit-Log) — the record TREK keeps on its own, with no configuration
- [Security-Hardening](Security-Hardening) — the rest of the operational checklist
