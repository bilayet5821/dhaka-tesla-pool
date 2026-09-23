# PRD traceability and release gates

IDs below follow the approved requirement analysis. Phase 3 covers request persistence, standalone estimates, owned history and `REQUESTED` cancellation; matching, pooled fares, other transitions, driver operations and product screens remain future work.

| ID | Component / deliverable | Required verification |
| --- | --- | --- |
| PROD-01 | Passenger and driver web flows, API, DB | Complete cast-based demo |
| PROD-02 | Auth module, passenger forms | Registration/login integration |
| PROD-03 | Request form/module, fare estimator | Route/seat/estimate checks |
| PROD-04 | Request state/history and UI | Status and cancellation tests |
| PROD-05 | Driver availability/matching UI and API | Online/offline and acceptance integration |
| PROD-06 | Trip module and driver UI | Arrival/start/complete/history integration |
| POOL-01 | Matching, membership, locked capacity allocation | Normal three-rider case and concurrent last-seat test |
| POOL-02 | Session checks and ownership-scoped serializers | Cross-user access/modification denial |
| POOL-03 | Separate state machines and append-only events | Invalid transitions and history tests |
| GEO-01 | Areas and deterministic compatibility service | Nusrat/Rafiq compatible route test |
| GEO-02 | Zone-only model | No map dependency; scope explained |
| FARE-01 | Tariff and fare calculator | Nusrat 11400 and Rafiq 14600 poysha test |
| FARE-02 | Integer poysha columns and formatting | Schema, rounding and hand-check review |
| FARE-03 | Cash selection and due policy | Completion/cancellation behavior; no gateway |
| STACK-01 | React/TypeScript web, Node/Express API | Build and Compose check |
| STACK-02 | PostgreSQL and choices in README | Alternatives, MVP rationale, switch criteria |
| API-01 | HTTP boundary and domain modules | Error, validation, state, integrity and basic security tests |
| UI-01 | Passenger and driver screens | End-to-end product tour |
| UI-02 | Shared loading/error/empty displays | Each key screen's state check |
| DB-01 | Migrations, constraints, indexes, transactions | Fresh migration and integrity tests |
| DB-02 | Optional payment/rating/audit extensions omitted | README records deliberate scope |
| OPS-01 | Compose, env example, migrations, story seed | Fresh-clone `docker compose up` check |
| OPS-02 | API and DB health checks | Liveness/readiness and Compose status |
| DEP-01 | Release process and README | Free URL if available, else specific Docker deployment constraint |
| DOC-01 | `architecture.md` diagram and ERD | Compare docs with final code/schema |
| DOC-02 | README | Audit every PRD section 12 documentation item |
| AI-01 | README AI Usage | Tool purposes, accepted and rejected/changed suggestion |
| GIT-01 | master, actual feature branches, pre-release, release/v1.0.0 | Check ancestry and merge flow |
| GIT-02 | Scoped logical commits | Git log review |
| TEST-01 | DB/API tests | All six behavior tests pass |
| VIDEO-01 | Video and prominent README link | Duration <=6 min and specified three blocks |
| SUB-01 | Public/evaluator-accessible release | Fresh-clone reviewer checklist |
| SCALE-01 | Optional scaling document | 1M passengers/100k drivers topics if attempted |

## Phase 3 evidence and remaining scope

| IDs | Implemented now | Remaining gate |
| --- | --- | --- |
| PROD-03, FARE-01, FARE-02 | Versioned Banani tariffs and integer-poysha request estimate; Nusrat 13000, Rafiq 17000 standalone tests | Pool-acceptance discount and accepted fare snapshots: Nusrat 11400, Rafiq 14600 |
| PROD-04, POOL-02, POOL-03 | Owned request reads/list, `REQUESTED` cancellation and transactional request events | Later request/pool states, full cancellation policy and frontend |
| GEO-01, GEO-02 | Eight named Dhaka areas; exactly two v1 bookable routes | Matching compatibility and multiple destinations in one pool |
| DB-01, OPS-01 | `0002_ride_domain.sql`, idempotent Dhaka and Bullet seed, FK/check/index constraints | Pool membership/capacity transaction and full fresh Compose verification |
| TEST-01, API-01 | Fare tests and real PostgreSQL API/integrity tests added | Run PostgreSQL integration gate and later capacity/concurrency tests |

## Six required behavior tests

1. Bullet's reserved seats never exceed three.
2. Invalid request and pool transitions are rejected.
3. Nusrat's and Rafiq's accepted pooled fares are 11400 and 14600 poysha.
4. One user cannot modify another user's ride.
5. Cancellation cutoffs and remaining-pool behavior hold.
6. Two simultaneous requests for exactly one remaining seat yield one MATCHED and one REQUESTED, without overbooking or corrupt history.

## Submission acceptance checklist

- [ ] Working passenger registration/sign-in, estimate/booking, own status/fare, allowed cancellation and history.
- [ ] Working Jashim login, availability, explicit Relevant Ride Requests section, acceptance, arrival, start, completion and history.
- [ ] Nusrat/Rafiq/Shirin normal demo; separate controlled one-seat concurrency test.
- [ ] Capacity, matching, fares, cash and two state machines conform to approved design.
- [ ] Six behavior tests above pass; ownership and failure responses work.
- [ ] Correct loading, error and empty UI states and a usable UI.
- [ ] Fresh Docker build/up, migration and cast seed; health checks; no committed credentials.
- [ ] Architecture diagram, ERD, README setup, screenshots/GIFs, API, trade-offs and AI Usage complete.
- [ ] Required branches and logical commits show feature -> master -> pre-release -> release/v1.0.0.
- [ ] Free public deployment URL if feasible, else documented reproducible Docker deployment.
- [ ] Maximum six-minute video link and PRD time blocks complete.
- [ ] Optional viral-scale reasoning clearly labelled if attempted.

The six-minute video must cover 0:00-1:00 problem/users/core idea in own words, 1:00-3:00 architecture, backend, frontend, DB, lifecycle, decision and trade-off while displaying architecture and ERD, and 3:00-6:00 passenger/driver flows, pooling, own fare/status, edge case and deployment if available.

Never pay for infrastructure, commit credentials, submit a giant finished-system initial commit, do all feature work on master, add technology solely for appearances, polish animation before integrity, hide AI usage, ship code you cannot explain, or replace the story cast with generic placeholders. Viral-scale reasoning may address load balancing, horizontal scaling, indexing/read replicas, caching, geospatial search, queues/events, realtime, rate limits, idempotency, observability, contention, matching, retries/failures, security and deployment **without adding those systems to the MVP**.
