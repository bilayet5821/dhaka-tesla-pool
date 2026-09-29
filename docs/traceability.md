# RoBenDevs PRD compliance audit — Phase 7

This audits the merged Phase 1–6 MVP against the mandatory PRD, not a future design. “Implemented” means source and tests exist; PostgreSQL/Compose execution is a separate verification gate. The local Phase 7 environment has no Docker or PostgreSQL executable; the pre-release CI workflow is configured to run these suites against a disposable PostgreSQL service when pushed. See README for the reproducible deployment path and the final verification report for actual command results.

| PRD area | Status | Implementation / evidence / outstanding gate |
| --- | --- | --- |
| Passenger signup/signin | Implemented | `auth` API, `users`/`sessions`, `/signup`, `/signin`, role guards and UI/API tests. |
| Request pickup/destination/seats and estimated fare | Implemented | `/areas`, `route_fares`, `ride-requests`, passenger booking form, 1–3 seats, standalone v1 estimate. Only two Banani routes are bookable. |
| Status, own history and valid cancellation | Implemented | Request state/events, owner-scoped list/detail/cancel; passenger active/history views. Cancellation allowed through DRIVER_ARRIVED, rejected after STARTED. |
| Driver signin, online/offline, own Tesla | Implemented | Seeded Jashim/Bullet, assigned vehicle API and driver dashboard; offline blocked during nonterminal pool. |
| Relevant Ride Requests, accept, arrival, start, complete, history | Implemented | Assigned pool list/detail/actions with member names/routes/seats/status and driver UI/history. |
| Shared pool, membership and capacity | Implemented | `0003_pooling.sql`, unique nonterminal vehicle pool and request membership; READ COMMITTED vehicle → pool → request locks and authoritative seat recount. |
| Individual fare and cash | Implemented | `0004_driver_flow.sql` immutable per-request snapshots; v1 tariff, discount at acceptance, integer poysha; cancelled pre-start cash due zero. Cash collection is outside MVP. |
| Simple geography and matching | Implemented | Eight named areas; Banani → Mohakhali and Banani → Gulshan 1 are the seeded compatible routes; unsupported route rejected and full/offline ride waits. |
| API design, auth, validation, security, errors | Implemented | Express REST modules, Zod, Argon2id, hashed opaque cookie sessions, Origin and JSON mutation checks, ownership, bounded pagination and consistent errors. |
| Frontend loading/error/empty states and API integration | Implemented | React Router passenger/driver pages, reusable feedback, UI tests. Full browser journey with real DB remains unverified in this environment. |
| Relational schema, relationships, constraints/indexes/history | Implemented | Numbered migrations 0001–0004, UUID/FKs/checks/partial unique indexes, event history and immutable snapshot trigger. Fresh DB execution remains unverified here. |
| Docker, `.env.example`, migrations and cast seed | Implemented; runtime gate pending | Compose web/API/PostgreSQL, health checks, migration ledger and idempotent Jashim/Nusrat/Rafiq/Shirin/Bullet seed. Docker unavailable here; follow README on a Docker host. |
| Architecture diagram, ERD, README, choices/alternatives, AI disclosure | Implemented | README and architecture/docs; no real screenshots/GIFs supplied. |
| Free deployment | Documented alternative; public deploy pending | No verified public URL or authenticated free host in this environment. Reproducible Docker deployment documented as PRD fallback. Never treat localhost as public deployment. |
| Git workflow | Phase 7 in progress | Feature branches merged into latest master; `pre-release` cut from that master. `release/v1.0.0` intentionally deferred to Phase 8. |
| Final ≤6-minute video/link | Pending Phase 8 | No recording or link supplied; do not claim one. |
| Optional viral-scale design | Not attempted | PRD marks this bonus optional. No speculative infrastructure added. |

## Six required behavior tests

| Required behavior | Existing automated coverage | Verification boundary |
| --- | --- | --- |
| Bullet never exceeds three seats | `pooling.integration.test.ts`: three-rider allocation, full waiting, last-seat contention | Requires real PostgreSQL. |
| Invalid transitions rejected | `pooling.integration.test.ts` and `driver.integration.test.ts`: repeated/stale actions with no partial writes/events | Requires real PostgreSQL. |
| Nusrat and Rafiq pooled fares | `driver.integration.test.ts`: accepted 11400/14600 poysha and immutable snapshots | Requires real PostgreSQL. |
| Other users cannot modify rides | `rides.db.test.ts`, `pooling.integration.test.ts`, driver ownership cases | Requires real PostgreSQL; unit route guards also run without it. |
| Cancellation rules | `pooling.integration.test.ts` and `driver.integration.test.ts`: seat release, waiting retry, final-member cancellation, post-start refusal | Requires real PostgreSQL. |
| Concurrent last seat | `pooling.integration.test.ts`: two separate connections and synchronized attempts with two seats reserved; one MATCHED, one REQUESTED, events and seat total checked | Requires real PostgreSQL; never substitute a mock. |

## Cast and final scope

Seed: Jashim drives Bullet (three passenger seats); Nusrat, Rafiq and Shirin are passengers. The normal Banani story and separate last-seat race are deliberately distinct. Requests and pools have separate state machines and transactionally recorded events. Phase 8 alone covers the release branch and final video; a public free URL remains conditional on a real verified free host. No map, gateway, microservice, Redis, Kafka or queue is part of the MVP.
