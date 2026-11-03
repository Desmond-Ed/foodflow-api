# FoodFlow API

[![CI](https://github.com/Desmond-Ed/foodflow-api/actions/workflows/ci.yml/badge.svg)](https://github.com/Desmond-Ed/foodflow-api/actions/workflows/ci.yml)

A backend service for a simplified food-delivery platform: vendors list menus,
customers place orders, riders get assigned, and orders move through a
defined status lifecycle. Built to mirror the kind of order-management system
a delivery platform like Chowdeck runs in production.

**v2 adds two modules aimed at real, Nigeria-specific engineering problems**
rather than generic CRUD: resolving messy local addresses into something a
delivery fee can be calculated against, and a properly hardened Paystack
webhook integration.

## Why this project

I built this to practice the specific things a backend engineering role
requires day to day: designing a relational schema, writing tested API
endpoints, adding a caching layer, handling errors consistently, and logging
enough detail to debug an issue in production without guessing.

**Why address resolution:** Nigerian addresses are a genuine, documented
backend problem — postal codes are barely used, and addresses are often
written as directions ("opposite so-and-so", no house number) rather than a
structured string. Standard geocoders choke on this; a Nigeria-focused
address startup (Lokate) exists specifically to solve it. This module
normalizes messy input, geocodes it against OpenStreetMap's free Nominatim
service (respecting its 1 req/sec limit with a queue), and falls back to a
small seeded landmark table for the addresses Nominatim can't place.

**Why Paystack:** Chowdeck's CTO was a Principal Engineer at Paystack before
co-founding Chowdeck, so payments infrastructure is core to the company's
DNA, not an add-on. A webhook handler is also one of the most failure-prone
parts of a real backend — duplicate events, forged payloads, out-of-order
delivery — so this module verifies every signature with a timing-safe HMAC
comparison and deduplicates events by Paystack's event ID before ever
touching order status.

## Tech stack

- **Node.js + Express** — REST API
- **MySQL** (via `mysql2`) — relational data: vendors, menu items, customers, riders, orders
- **Redis** — caching for read-heavy endpoints (vendor menus)
- **Jest + Supertest** — unit and integration tests
- **Winston** — structured logging
- **Docker Compose** — one-command local MySQL + Redis for development
- **Nominatim (OpenStreetMap)** — free geocoding, no API key required
- **Paystack** (test mode) — payment initialization + webhook confirmation

## Architecture

```
src/
  config/       # DB pool and Redis client setup
  models/       # SQL queries and business rules (status transitions, totals, payments)
  services/     # External integrations: geocoding, delivery fees, Paystack (v2)
  routes/       # Express route handlers, one file per resource
  middleware/   # Request logging, centralized error handling
  utils/        # Logger
  app.js        # Wires middleware + routes together
  server.js     # Boots the app and connects to Redis
tests/          # Jest + Supertest, mocking DB/Redis/external HTTP so tests run anywhere
migrations/     # SQL schema + seed data
```

```
                          ┌────────────┐
                          │   CLIENT   │
                          └─────┬──────┘
                                │ HTTP/JSON
                                ▼
                     ┌─────────────────────┐
                     │     EXPRESS API      │
                     │  helmet·cors·limiter │
                     │  request logger      │
                     ├─────────────────────┤
                     │ /api/vendors         │
                     │ /api/orders          │
                     │ /api/addresses  (NEW)│
                     │ /api/delivery   (NEW)│
                     │ /api/payments   (NEW)│
                     │ /api/health          │
                     └──────┬───────┬───────┘
                            │       │
             ┌──────────────┘       └───────────────┐
             ▼                                       ▼
      ┌─────────────┐                        ┌───────────────┐
      │    MYSQL     │                        │     REDIS      │
      │ orders·vendors│                       │ menu cache      │
      │ payments (NEW)│                       │ geocode cache   │
      │ resolved_addr │                       │  (NEW)          │
      │ (NEW)         │                        └───────────────┘
      └─────────────┘

      External services (both free/test-mode):
      → Nominatim (OpenStreetMap) — geocoding
      → Paystack (test mode) — payment processing + webhooks
```

Key decisions:

- **Connection pooling, not a single connection.** `mysql2`'s pool lets the
  API handle concurrent requests without one slow query blocking the next.
- **Redis is a performance layer, not a dependency.** If Redis is unreachable,
  reads fall back to MySQL and the app logs the failure instead of crashing.
  The `/api/health` endpoint reports Redis status separately from "the API is up".
- **Order status transitions are validated server-side.** An order can't jump
  from `pending` straight to `delivered` — the allowed transitions are
  enforced in `orderModel.js`, not left to whichever client calls the API.
- **Order creation is a transaction.** Calculating the total, inserting the
  order, and inserting each line item either all succeed or all roll back,
  so a failed request never leaves a half-created order in the database.
- **Geocoding is cache-first, always.** Every address resolution checks Redis
  then MySQL before ever calling Nominatim, and a shared queue enforces its
  1 req/sec limit even under concurrent requests.
- **Webhook signatures are verified over the raw request body**, using a
  route-scoped raw-body middleware mounted *before* the global JSON parser —
  otherwise Express would re-serialize the body and the HMAC would never match.
- **Webhook processing is idempotent and transactional.** Recording the event
  ID and updating order/payment status happen in the same MySQL transaction,
  and that write completes *before* the 2xx is sent — only genuinely
  non-critical follow-up (e.g. notifying the vendor) happens after the ack.

## API reference

| Method | Endpoint                  | Description                                   |
|--------|----------------------------|------------------------------------------------|
| GET    | `/api/health`              | Liveness check; confirms the process is running |
| GET    | `/api/ready`               | Readiness check; reports MySQL and Redis reachability |
| GET    | `/api/vendors`             | List active vendors                            |
| GET    | `/api/vendors/:id/menu`    | Get a vendor's available menu (cached in Redis) |
| POST   | `/api/orders`              | Create an order from a list of menu items       |
| GET    | `/api/orders/:id`          | Fetch a single order                            |
| PATCH  | `/api/orders/:id/status`   | Move an order to its next valid status          |
| POST   | `/api/addresses/resolve`  | Normalize + geocode a raw address string        |
| POST   | `/api/delivery/quote`     | Get distance + delivery fee for a vendor/address pair |
| POST   | `/api/payments/initialize`| Start a Paystack transaction for an order       |
| POST   | `/api/payments/webhook`   | Paystack calls this to confirm payment          |
| GET    | `/api/payments/:orderId/status` | Check an order's payment status            |

**Example — resolve a messy address:**

```bash
curl -X POST http://localhost:3000/api/addresses/resolve \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{ "rawAddress": "opposite Ikeja City Mall, no house number" }'
```

**Example — get a delivery quote:**

```bash
curl -X POST http://localhost:3000/api/delivery/quote \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{ "vendorId": 1, "customerAddress": "12 Allen Avenue, Ikeja" }'
```

**Example — initialize a payment:**

```bash
curl -X POST http://localhost:3000/api/payments/initialize \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{ "orderId": 1, "email": "customer@example.com" }'
```

**Example — create an order:**

```bash
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "customerId": 1,
    "vendorId": 1,
    "items": [{ "menuItemId": 1, "quantity": 2 }]
  }'
```

**Example — advance an order's status:**

```bash
curl -X PATCH http://localhost:3000/api/orders/1/status \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{ "status": "preparing" }'
```

## Authentication

Orders, addresses, delivery quotes, and payment initialize/status require an
`x-api-key` header matching `API_KEY`:

```bash
curl http://localhost:3000/api/orders/1 \
  -H "x-api-key: $API_KEY"
```

The public endpoints are `/api/health`, `/api/ready`, `/api/vendors`,
`/api/vendors/:id/menu`, and the Paystack webhook. `API_KEY` is mandatory in
production: the server refuses to start without it. The Paystack webhook is
authenticated separately by verifying the `x-paystack-signature` HMAC against
the raw request body, so it never accepts the API key.

CORS is deny-by-default in production. Set `CORS_ORIGIN` to the exact browser
origin that should be allowed (for example
`https://your-frontend.example.com`); leaving it empty in production denies
cross-origin browser requests. Development is permissive when `CORS_ORIGIN` is
unset.

## Configuration

Copy `.env.example` to `.env` and fill in the placeholders. No real secrets belong in the repository.

| Variable | Example placeholder | Purpose |
|----------|---------------------|---------|
| `PORT` | `3000` | Port the API listens on. |
| `API_KEY` | `<long-random-api-key>` | Shared key required in the `x-api-key` header on protected endpoints. Mandatory in production. |
| `CORS_ORIGIN` | `https://<frontend-origin>` | Exact browser origin allowed by CORS; empty denies cross-origin browser requests. |
| `DB_HOST` | `localhost` | MySQL host. |
| `DB_PORT` | `3306` | MySQL port. |
| `DB_USER` | `<db-user>` | MySQL user. |
| `DB_PASSWORD` | `<db-password>` | MySQL password. |
| `DB_NAME` | `foodflow` | MySQL database name. |
| `DB_SSL` | `false` | Set to `true` to require TLS for MySQL connections. |
| `DB_SSL_CA` | `<ca-certificate>` | CA certificate for MySQL TLS; required when `DB_SSL=true`. |
| `REDIS_URL` | `redis://<host>:<port>` | Redis connection URL. Use `rediss://` for TLS. |
| `REDIS_CONNECT_TIMEOUT_MS` | `2000` | Redis connection timeout in milliseconds. |
| `REDIS_TLS_CA` | `<ca-certificate>` | CA certificate for Redis TLS when using `rediss://`. |
| `TRUST_PROXY` | `false` | Trusted proxy hop count; set to `1` behind a single reverse proxy (e.g. Render). |
| `RATE_LIMIT_MAX` | `100` | Maximum general API requests per minute per IP. |
| `WEBHOOK_RATE_LIMIT_MAX` | `1000` | Maximum Paystack webhook requests per minute per IP. |
| `LOG_LEVEL` | `info` | Winston log level. |
| `NOMINATIM_USER_AGENT` | `<app-name> (<contact-email>)` | Required Nominatim User-Agent identifying the app and a contact. |
| `NOMINATIM_MIN_INTERVAL_MS` | `1000` | Minimum interval between Nominatim calls in milliseconds (rate limiting). |
| `NOMINATIM_TIMEOUT_MS` | `5000` | Outbound Nominatim request timeout in milliseconds. |
| `PAYSTACK_SECRET_KEY` | `sk_test_<placeholder>` | Paystack secret key (test mode). |
| `PAYSTACK_PUBLIC_KEY` | `pk_test_<placeholder>` | Paystack public key (test mode). |
| `PAYSTACK_TIMEOUT_MS` | `10000` | Outbound Paystack initialize request timeout in milliseconds. |
| `PAYMENT_PENDING_TTL_MINUTES` | `30` | How long a pending payment blocks a new initialize request before it can be retried. |

`TRUST_PROXY` must be set to `1` behind a single reverse proxy such as Render; leave it `false` when the API is directly exposed. `RATE_LIMIT_MAX` caps general API traffic and `WEBHOOK_RATE_LIMIT_MAX` caps webhook traffic separately so Paystack retries are not blocked by the general limit. `NOMINATIM_TIMEOUT_MS` bounds outbound geocoding calls and `PAYSTACK_TIMEOUT_MS` bounds outbound payment initialization calls. `DB_SSL=true` fails fast unless `DB_SSL_CA` is provided, and the certificate is verified rather than accepted blindly.

### Health checks

`GET /api/health` is a liveness probe. It never calls MySQL or Redis, so it
returns HTTP `200` as long as the process is running. This is what the Render
health check points at, preventing a slow dependency from restarting a healthy
instance.

`GET /api/ready` is a readiness probe. MySQL is a hard dependency: if it is
unreachable the endpoint returns HTTP `503` with status `"degraded"`. Redis is
optional: if it is down the endpoint still returns HTTP `200`, with status
`"degraded"` and `dependencies.redis: "down"`.

## Running locally

```bash
# 1. Start MySQL + Redis
docker compose up -d

# 2. Use Node 22 (pinned in .nvmrc)
nvm use

# 3. Install dependencies
npm install

# 4. Set up environment variables
cp .env.example .env
# Fill in NOMINATIM_USER_AGENT and PAYSTACK_SECRET_KEY/PAYSTACK_PUBLIC_KEY
# (a free Paystack test-mode account provides sandbox keys)

# 5. Run the API
npm run dev
```

The API will be available at `http://localhost:3000`.

On first boot the MySQL container applies `migrations/` and then
`seeds/dev_seed.sql`. To recreate the database from scratch, run
`docker compose down -v` before `docker compose up -d`. `npm run migrate` is
for databases that were not initialized by Docker, such as the hosted Aiven
instance described under [Deployment](#deployment).

## Running tests

```bash
npm test
```

Tests mock MySQL, Redis, and outbound HTTP (Nominatim, Paystack), so the
whole suite — including webhook signature verification and idempotency —
runs without any live database or external service.

## Deployment

The repository includes a [Render](https://render.com) Blueprint
(`render.yaml`) that provisions one free Node web service. It is designed to
run against the free tiers of [Aiven](https://aiven.io) for MySQL and Valkey
(Redis-compatible). Live URL: _add after deploying_.

### Provision the services

1. Create an **Aiven for MySQL** free service. Copy its host, port, user,
   password, database name, and CA certificate.
2. Create an **Aiven for Valkey** free service. Copy its connection URI. Use
   the `rediss://` scheme and copy the CA certificate when TLS is enabled.
3. Push this repository to GitHub, then create a Render Blueprint from
   `render.yaml`. The Blueprint sets `NODE_VERSION=22`, `NODE_ENV=production`,
   `TRUST_PROXY=1`, `LOG_LEVEL=info`, and `DB_SSL=true`; it marks every secret
   and connection setting as `sync: false`.
4. Fill in the `sync: false` variables in the Render dashboard:
   `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL_CA`,
   `REDIS_URL`, `REDIS_TLS_CA`, `API_KEY`, `CORS_ORIGIN`,
   `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `NOMINATIM_USER_AGENT`, and
   `NOMINATIM_MIN_INTERVAL_MS`.

Aiven MySQL defaults to the `defaultdb` database and the `avnadmin` user, so
set `DB_NAME=defaultdb` unless you create a separate database. When setting
`DB_SSL_CA`, paste the certificate with literal `\n` sequences (for example as
a single-line environment variable); the app converts them to real newlines.

The service builds with `npm ci --omit=dev`, starts with
`node src/server.js`, and Render checks liveness at `/api/health`.

### Run database migrations

The hosted database is not initialized by Docker, so apply the tracked
migrations once from your machine. Export the connection values for the
current shell session only; do not write them to a committed `.env` file:

```bash
export DB_HOST="<aiven-mysql-host>"
export DB_PORT="<aiven-mysql-port>"
export DB_USER="<aiven-mysql-user>"
export DB_PASSWORD="<aiven-mysql-password>"
export DB_NAME="<aiven-mysql-database>"
export DB_SSL=true
export DB_SSL_CA="$(cat /path/to/aiven-ca.pem)"

npm run migrate

unset DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME DB_SSL DB_SSL_CA
```

`npm run migrate` records each applied filename in `schema_migrations`, prints
only the applied or skipped migration filenames, and stops at the first
failure. It is safe to run again: already-applied migrations are skipped.
In PowerShell, set the same values for the session with
`$env:DB_HOST="..."` and remove them with `Remove-Item Env:DB_HOST`.

### Seed development data

`npm run seed` applies `seeds/dev_seed.sql` using the same `DB_*` and
`DB_SSL*` variables as the app. It checks the `vendors` table first and does
nothing if any vendors already exist, printing `skipped: vendors not empty`.
It is intended for a fresh development or hosted database and prints no
connection values.

### A note on the geocoding provider

Address resolution currently calls the free public **Nominatim** (OpenStreetMap)
API. That service's [usage policy](https://operations.osmfoundation.org/policies/nominatim/)
restricts the public endpoint to interactive, user-triggered lookups with light
traffic, caching, and a low request rate — it explicitly isn't meant to sit
behind a live, continuously-running production API. This project respects the
rate limit (a queue caps calls at 1 req/sec) and caches every result in Redis
and MySQL so the same address is never looked up twice, but it's still built
on the free public instance rather than a paid or self-hosted one.

**In practice:** this module is a demo of the address-resolution logic, not a
production-scale geocoder. Anyone deploying this for real, sustained traffic
should either self-host Nominatim or switch to a commercial provider (Google
Geocoding, Mapbox, etc.) — the `geocodingService.js` interface is written so
that swap only touches one file.

## Known limitations

- Free Render web services sleep after inactivity, so the first request after
  a quiet period can take a while (cold start).
- Aiven may power off idle free-tier MySQL or Valkey services; they may need
  to be restarted from the Aiven console before the API can reconnect.
- Address resolution uses the public Nominatim endpoint, which is intended for
  light, demo-level traffic rather than sustained production use.
- Cancelling an order that has already been paid does not issue a refund; the
  payment record and Paystack charge are left untouched.
- Redis is optional at runtime. If it is unavailable the API still serves
  requests but caching and geocoding rate limiting degrade.

## What I'd add next

- Pagination on `GET /api/vendors` and order history endpoints
- Rider assignment logic (currently a rider can be linked to an order but nothing auto-assigns one)
- Idempotency keys on `POST /api/orders` to safely handle client retries
- A larger, more systematic landmark table for address fallback (currently a
  small hand-seeded set of well-known Ikeja/Lagos locations)
- Refund handling and a `charge.failed`/dispute path in the Paystack webhook,
  beyond the `charge.success` case handled now
- Retry/backoff around Nominatim errors instead of falling straight to the
  landmark table on any non-200 response

---

Built by Desmond Eguono as part of my application to Chowdeck's Junior Backend Engineer role.
