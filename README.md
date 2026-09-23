# Dhaka Tesla Pool

Share a seat. Split the fare. Survive Dhaka traffic.

The `feature/auth` branch implements **Phase 2: API authentication** on top of the Phase 1 foundation. It has passenger registration/login, seeded driver login, server-side sessions, logout, role-guard foundations and health endpoints. The React app is still a placeholder. Bookings, vehicles, pooling, fare calculation, trip controls and product UI belong to later `feature/*` branches.

## Design source and architecture

The RoBenDevs PRD governs the deliverable. Approved decisions, cast, compatibility rule, hand-computable fares and security contract are in [assumptions](docs/assumptions.md), [architecture/ERD](docs/architecture.md), [API contract](docs/api.md) and [PRD traceability](docs/traceability.md). Browser → React web → Node API → PostgreSQL; one modular monolith. The normal story uses Nusrat, Rafiq, Shirin, Jashim and Bullet. The separate last-seat concurrency test is planned for the pooling feature branch.

## Stack and decisions

React + Vite avoids unnecessary server rendering for authenticated screens (alternative: Next.js when SSR is needed). Express keeps a small API understandable (alternative: Fastify for measured performance or NestJS for a much larger team). PostgreSQL supports seat-allocation row locks, transactions and partial unique indexes (alternative: SQLite only for a single-process demo). Parameterized `pg` queries and SQL migrations expose integrity rules (alternative: ORM when the schema grows). CSS stays small (alternative: component library for more screens). Vitest tests business risk (alternative: another runner if toolchain changes). Revisit these choices only for measured needs or deployment constraints.

## Project structure

- `apps/web`: React client and placeholder screen.
- `apps/api`: Express API, DB connection, migrations and health tests.
- `infra`: container images and web proxy configuration.
- `docs`: approved product decisions, architecture, ERD and planned API.

## Prerequisites and setup

Node.js 24, npm, and (for the database) Docker Engine with Compose. Copy `.env.example` to `.env`, set a private PostgreSQL password and set `AUTH_DEMO_PASSWORD` to a private, strong password of 12–128 characters. Keep both in the ignored `.env`; **never commit secrets**. The DB and API ports bind to local loopback only. `APP_ORIGIN` defaults to `http://localhost:3000` for Compose; if the web port changes, adjust it. For local Vite development, `http://localhost:5173` is also allowed outside production. Production must use HTTPS and set `APP_ORIGIN` to its exact HTTPS web origin.

```sh
cp .env.example .env
npm ci
docker compose up --build
```

The Compose API starts by applying SQL migrations, idempotently seeding the four demo accounts, then starting the server. The migration runner records SHA-256 hashes of numbered SQL files. The auth migration creates only `users` and `sessions`; **no ride tables exist yet**. `docker compose up` on later runs uses built images; `--build` rebuilds after code changes. On a host with PostgreSQL outside Compose, export `DATABASE_URL` and `AUTH_DEMO_PASSWORD`, then run `npm run migrate`, `npm run seed`, `npm run dev:api`, and `npm run dev:web` as needed. Vite proxies `/api` to localhost:3001 during local development.

## Run checks

```sh
npm run build
npm run lint
npm test
```

After Compose is healthy, web: `http://localhost:3000`, API liveness: `http://localhost:3001/api/v1/health/live`, API readiness: `http://localhost:3001/api/v1/health/ready`. Liveness does not access DB; readiness requires DB and migration ledger.

**Demo logins:** `jashim@demo.dhakatesla.local` (DRIVER), `nusrat@demo.dhakatesla.local`, `rafiq@demo.dhakatesla.local`, and `shirin@demo.dhakatesla.local` (PASSENGER). All use the **private password you set in `AUTH_DEMO_PASSWORD`**. Seeding does not reset an existing account's password: if you change that variable later, use a fresh local database or change credentials through a future account-management flow. Do not use a real personal password for the shared demo accounts.

Auth endpoints are `POST /api/v1/auth/register`, `POST /login`, `POST /logout`, and `GET /me`. POST requests require `Content-Type: application/json` and an exact allowed `Origin`, including direct API calls. For example, to register, send JSON `{ "name": "Example", "email": "example@example.com", "password": "a-unique-strong-passphrase" }` with `Origin: http://localhost:3000`; the response sets an HttpOnly cookie. Refer to [auth design and security](docs/auth.md) for the contract. No public driver signup exists.

## Deployment, limitations and next work

No public deployment URL or six-minute video exists in Phase 2. Only free hosting will be considered. Docker provides a reproducible route when a suitable free backend/database service is unavailable. Next: vehicle/ride schema, concurrent matching/capacity, fares and lifecycle, product UIs, then integration/release checks. The auth throttle is process-local and would need shared coordination if the API gained replicas. The final README must include screenshots/GIFs, the video link, expanded API overview, verified limitations, AI Usage examples and optional viral-scale discussion before submission.

## AI Usage (work in progress)

ChatGPT/Codex was used to analyze the PRD, propose/document design decisions, scaffold the foundation and implement Phase 2 authentication. One accepted suggestion: separate system matching from Jashim's pool acceptance, and keep request state separate from pool state. One changed suggestion: an earlier analysis conflated `MATCHED/ACCEPTED`; the design was corrected because matching and driver acceptance have different actors. All generated changes require testing and explanation before shipping.
