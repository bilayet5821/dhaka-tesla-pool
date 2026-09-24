# REST API contract (partially implemented)

Base prefix `/api/v1`; JSON success `{ "data": ... }`, error `{ "error": { "code", "message", "details"? } }`. Use integer-poysha monetary fields, bounded pagination, session cookie authentication and server-side ownership checks. Keep request IDs in a response header.

**Implemented through `feature/tesla-pooling`:** health, auth, `GET /areas`, the four owned request operations, and synchronous system allocation. The separate `/fares/estimate` and driver endpoints remain planned. Auth behavior and security settings are in [auth.md](auth.md).

| Method and path | Principal | Purpose |
| --- | --- | --- |
| `GET /health/live`, `GET /health/ready` | public | Process liveness and DB/schema readiness |
| `POST /auth/register`, `/auth/login`; `POST /auth/logout`; `GET /auth/me` | public; authenticated for logout/me | Passenger signup, login/seeded driver login, revocation, own safe profile |
| `GET /areas`; `POST /fares/estimate` | public; passenger | Available zones (implemented); separate fare quote (planned) |
| `POST /ride-requests`; `GET /ride-requests?scope=active|history`; `GET /ride-requests/:id`; `POST /ride-requests/:id/cancel` | passenger | Create, inspect, list and cancel **own** requests |
| `GET /driver/vehicle`; `PATCH /driver/vehicle/availability` | assigned driver | View Bullet and switch online/offline if safe |
| `GET /driver/pools?scope=open|active|history`; `GET /driver/pools/:id` | assigned driver | Show pool and **Relevant Ride Requests** for OPEN pools |
| `POST /driver/pools/:id/accept`, `/arrive`, `/start`, `/complete` | assigned driver | Apply exact driver-controlled pool transitions |

Validation: Zod at HTTP boundaries; request seats 1..3, distinct supported pickup/destination, allowed route, and `CASH`; database constraints provide defense in depth. Proposed errors: 400 `INVALID_INPUT`, 401 `AUTH_REQUIRED`/`INVALID_CREDENTIALS`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `INVALID_TRANSITION`/`ACTIVE_REQUEST_EXISTS`/`VEHICLE_BUSY`, 429 `RATE_LIMITED`, 500 `INTERNAL_ERROR`, 503 `DEPENDENCY_UNAVAILABLE`. Automatic matching with no seat is **201**, request state `REQUESTED`, allocation waiting; it is not an overbooking or 409. Do not leak SQL, cookies or secrets. Driver UI must show loading/error/empty states, including an empty Relevant Ride Requests section.

## Phase 3 request contract

`GET /areas` returns `{ data: [{ id, code, name }] }` for all named Dhaka areas. Only Banani → Mohakhali and Banani → Gulshan 1 are bookable in v1; other named areas are listed for future tariffs.

`POST /ride-requests` takes `{ "pickupAreaId": "uuid", "destinationAreaId": "uuid", "seats": 1 }` and returns 201 `{ data: { id, pickupAreaId, destinationAreaId, seats, status: "REQUESTED", estimatedFarePoysha, pricingVersion, paymentMethod: "CASH", createdAt, updatedAt, cancelledAt: null } }`. This is the approved standalone estimate (Nusrat 13000, Rafiq 17000 poysha for one seat). In Phase 4, the response may instead have status `MATCHED` if an online vehicle has an eligible OPEN pool or can start one. The estimate remains standalone; no pool discount is committed before acceptance. Wrong/unknown area IDs or an unsupported direction yield 400 `UNSUPPORTED_ROUTE`; equal endpoints, malformed UUID, extra fields or seats outside 1..3 yield 400 `INVALID_INPUT`. A second active request yields 409 `ACTIVE_REQUEST_EXISTS`.

`GET /ride-requests?scope=active|history&limit=20&offset=0` defaults to active, bounds `limit` to 1..50 and `offset` to 0..10000, returns `{ data: [request] }` newest first. History includes completed/cancelled requests. `GET /ride-requests/:id` returns an owned request plus `events: [{ id, fromState, toState, reason, actorUserId, occurredAt }]`; unowned/unknown IDs return 404 without revealing existence. `POST /ride-requests/:id/cancel` takes `{}` with JSON content type and allowed Origin; the owner may cancel `REQUESTED` or `MATCHED` requests. A MATCHED cancellation releases its seat; an empty OPEN pool becomes CANCELLED. It returns the cancelled request, preserves its quote as history, and writes the transition event atomically. Repeated cancellation returns 409 `INVALID_TRANSITION`. Later pre-start states beyond MATCHED remain for the driver-flow phase. All four ride operations require a passenger session; driver sessions get 403.

## Phase 4 matching behavior

Matching is a system action during request creation; no passenger or driver matching endpoint exists. A request remains `REQUESTED` with 201 when Bullet is offline, full, or there is no compatible OPEN pool and Bullet is busy. Active pools are considered by `(created_at, id)`; if an eligible vehicle has no active pool, the system creates an OPEN pool. All booked v1 destinations use the approved Banani compatibility rule. Seat release synchronously retries waiting requests after cancellation. Going online and completing a pool will trigger retries when those endpoints are implemented. The passenger response contains only that passenger's status and standalone estimate, never other members' details.
