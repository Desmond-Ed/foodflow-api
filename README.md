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
| GET    | `/api/health`              | Reports API status plus MySQL/Redis reachability |
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
  -d '{ "rawAddress": "opposite Ikeja City Mall, no house number" }'
```

**Example — get a delivery quote:**

```bash
curl -X POST http://localhost:3000/api/delivery/quote \
  -H "Content-Type: application/json" \
  -d '{ "vendorId": 1, "customerAddress": "12 Allen Avenue, Ikeja" }'
```

**Example — initialize a payment:**

```bash
curl -X POST http://localhost:3000/api/payments/initialize \
  -H "Content-Type: application/json" \
  -d '{ "orderId": 1, "email": "customer@example.com" }'
```

**Example — create an order:**

```bash
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
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
  -d '{ "status": "accepted" }'
```

## Configuration

Copy `.env.example` to `.env` and fill in the placeholders. No real secrets belong in the repository.

| Variable | Example placeholder | Purpose |
|----------|---------------------|---------|
| `PORT` | `3000` | Port the API listens on. |
| `DB_HOST` | `localhost` | MySQL host. |
| `DB_PORT` | `3306` | MySQL port. |
| `DB_USER` | `<db-user>` | MySQL user. |
| `DB_PASSWORD` | `<db-password>` | MySQL password. |
| `DB_NAME` | `foodflow` | MySQL database name. |
| `REDIS_URL` | `redis://<host>:<port>` | Redis connection URL. |
| `REDIS_CONNECT_TIMEOUT_MS` | `2000` | Redis connection timeout in milliseconds. |
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

`TRUST_PROXY` must be set to `1` behind a single reverse proxy such as Render; leave it `false` when the API is directly exposed. `RATE_LIMIT_MAX` caps general API traffic and `WEBHOOK_RATE_LIMIT_MAX` caps webhook traffic separately so Paystack retries are not blocked by the general limit. `NOMINATIM_TIMEOUT_MS` bounds outbound geocoding calls and `PAYSTACK_TIMEOUT_MS` bounds outbound payment initialization calls.

### Health checks

`GET /api/health` returns HTTP `200` while MySQL is up. If Redis is also up the response status is `"ok"`; if Redis is down it is `"degraded"` but the endpoint still returns `200`. When MySQL is down the endpoint returns HTTP `503` with status `"degraded"`.

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

## Running tests

```bash
npm test
```

Tests mock MySQL, Redis, and outbound HTTP (Nominatim, Paystack), so the
whole suite — including webhook signature verification and idempotency —
runs without any live database or external service.

## Deployment

Deployed on [Render](https://render.com) with a free-tier MySQL database on
[PlanetScale](https://planetscale.com) and Redis on
[Upstash](https://upstash.com). Live URL: _add after deploying_.

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
