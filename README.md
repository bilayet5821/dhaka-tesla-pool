# Dhaka Tesla Pool

Share a seat. Split the fare. Survive Dhaka traffic.

This repository is currently **Phase 1: project foundation**, not a working ride-pooling MVP. It contains a React/TypeScript placeholder web app, a Node.js/Express/TypeScript API with liveness/readiness endpoints, PostgreSQL Compose infrastructure and a versioned SQL migration runner. Authentication, bookings, pooling, fare computation and driver features belong to later `feature/*` branches.

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

Node.js 24, npm, and (for the database) Docker Engine with Compose. Copy `.env.example` to `.env` and replace the example database password. `.env` is ignored; **never commit secrets**. The DB is exposed locally for development, so use local-only credentials. A production deployment requires HTTPS for secure auth cookies.

```sh
cp .env.example .env
npm ci
docker compose up --build
```

The Compose API starts by applying SQL migrations; the foundation runner creates `schema_migrations` and verifies SHA-256 hashes of applied numbered SQL files. There are **no ride tables or demo seed records yet**. `docker compose up` on later runs uses the built images; `--build` rebuilds after code changes. On a host with PostgreSQL outside Compose, set `DATABASE_URL` and use `npm run migrate`, `npm run dev:api`, `npm run dev:web` in separate terminals. Vite proxies `/api` to localhost:3001 during local development.

## Run checks

```sh
npm run build
npm run lint
npm test
```

After Compose is healthy, web: `http://localhost:3000`, API liveness: `http://localhost:3001/api/v1/health/live`, API readiness: `http://localhost:3001/api/v1/health/ready`. Liveness does not access DB; readiness requires DB and migration ledger. The driver/passenger demo credentials and seed instructions will be added with those features, not invented for Phase 1.

## Deployment, limitations and next work

No public deployment URL or six-minute video exists in Phase 1. Only free hosting will be considered. Docker provides a reproducible route when a suitable free backend/database service is unavailable. Next: authentication, story-cast schema and seed, concurrent matching/capacity, fares and lifecycle, product UIs, then integration/release checks. The final README must include screenshots/GIFs, demo credentials, the video link, API overview, verified limitations, AI Usage examples and optional viral-scale discussion before submission.

## AI Usage (work in progress)

ChatGPT/Codex was used to analyze the PRD, propose/document design decisions, and scaffold the Phase 1 foundation. One accepted suggestion: separate system matching from Jashim's pool acceptance, and keep request state separate from pool state. One changed suggestion: an earlier analysis conflated `MATCHED/ACCEPTED`; the design was corrected because matching and driver acceptance have different actors. All generated changes require testing and explanation before shipping.
