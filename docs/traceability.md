# RoBenDevs PRD compliance audit — Phase 7

This audits the merged Phase 1–6 MVP against the mandatory PRD, not a future design. “Implemented” means source and tests exist. The user's local Docker/PostgreSQL run completed the runtime gate: Docker build succeeded, web/API/DB were healthy, PostgreSQL API tests passed 31/31, frontend tests passed 9/9, **40/40 total, 0 failed, 0 skipped**, and a browser walkthrough of Nusrat, Rafiq and Jashim was verified. Selected supplied screenshots are in `docs/screenshots/` and README. This Work environment lacks Docker/PostgreSQL, so those results are attributed to the user's local verification rather than an independent rerun here. The pre-release CI workflow will run its own disposable-PostgreSQL checks when pushed.

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
| Frontend loading/error/empty states and API integration | Implemented; locally verified | React Router passenger/driver pages and UI tests; user-verified full local browser journey for Nusrat, Rafiq and Jashim; supplied screenshots document representative states. |
| Relational schema, relationships, constraints/indexes/history | Implemented; locally verified | Numbered migrations 0001–0004, UUID/FKs/checks/partial unique indexes, event history and immutable snapshot trigger; real PostgreSQL API suite passed 31/31 locally. |
| Docker, `.env.example`, migrations and cast seed | Implemented; locally verified | Compose web/API/PostgreSQL built and healthy in the user's local run; migration/seed-backed story journey and 31/31 API tests succeeded. Not independently rerun in this Work environment. |
| Architecture diagram, ERD, README, choices/alternatives, AI disclosure | Implemented | README and architecture/docs; real, unmodified local screenshots supplied and linked. |
| Free deployment | Documented alternative; public deploy pending | No verified public URL or authenticated free host in this environment. Reproducible Docker deployment documented as PRD fallback. Never treat localhost as public deployment. |
| Git workflow | Completed | `release/v1.0.0` was cut from the verified `pre-release` branch after release checks. |
| Final demo video/link | Completed | Final product walkthrough recorded and linked prominently from README. |
| Optional viral-scale design | Not attempted | PRD marks this bonus optional. No speculative infrastructure added. |

## Six required behavior tests

| Required behavior | Existing automated coverage | Verification boundary |
| --- | --- | --- |
| Bullet never exceeds three seats | `pooling.integration.test.ts`: three-rider allocation, full waiting, last-seat contention | Included in user's 31/31 real PostgreSQL API pass. |
| Invalid transitions rejected | `pooling.integration.test.ts` and `driver.integration.test.ts`: repeated/stale actions with no partial writes/events | Included in user's 31/31 real PostgreSQL API pass. |
| Nusrat and Rafiq pooled fares | `driver.integration.test.ts`: accepted 11400/14600 poysha and immutable snapshots | Included in user's 31/31 real PostgreSQL API pass; local browser screenshots show BDT 114/146 histories. |
| Other users cannot modify rides | `rides.db.test.ts`, `pooling.integration.test.ts`, driver ownership cases | Included in user's 31/31 real PostgreSQL API pass. |
| Cancellation rules | `pooling.integration.test.ts` and `driver.integration.test.ts`: seat release, waiting retry, final-member cancellation, post-start refusal | Included in user's 31/31 real PostgreSQL API pass. |
| Concurrent last seat | `pooling.integration.test.ts`: two separate connections and synchronized attempts with two seats reserved; one MATCHED, one REQUESTED, events and seat total checked | Included in user's 31/31 real PostgreSQL API pass; not a mocked race. |

## Cast and final scope

Seed: Jashim drives Bullet (three passenger seats); Nusrat, Rafiq and Shirin are passengers. The normal Banani story and separate last-seat race are deliberately distinct. Requests and pools have separate state machines and transactionally recorded events. Phase 8 alone covers the release branch and final video; a public free URL remains conditional on a real verified free host. No map, gateway, microservice, Redis, Kafka or queue is part of the MVP.
