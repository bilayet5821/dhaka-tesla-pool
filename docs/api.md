# REST API contract (partially implemented)

Base prefix `/api/v1`; JSON success `{ "data": ... }`, error `{ "error": { "code", "message", "details"? } }`. Use integer-poysha monetary fields, bounded pagination, session cookie authentication and server-side ownership checks. Keep request IDs in a response header.

**Implemented through `feature/driver-flow`:** health, auth, `GET /areas`, owned request operations, system allocation, driver vehicle controls and assigned pool lifecycle/history. The separate `/fares/estimate` remains planned. Auth behavior and security settings are in [auth.md](auth.md).

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

`GET /ride-requests?scope=active|history&limit=20&offset=0` defaults to active, bounds `limit` to 1..50 and `offset` to 0..10000, returns `{ data: [request] }` newest first. History includes completed/cancelled requests. `GET /ride-requests/:id` returns an owned request plus `events: [{ id, fromState, toState, reason, actorUserId, occurredAt }]`; unowned/unknown IDs return 404. Request responses include `finalFarePoysha`, `cashDuePoysha`, and `fareSnapshot` (null before acceptance). Snapshots contain `pricingVersion`, `seatCount`, `basePerSeatPoysha`, `zonePerSeatPoysha`, `discountPerSeatPoysha`, `totalPoysha`, `committedAt`. A cancelled request owes zero cash and retains its accepted snapshot. `POST /ride-requests/:id/cancel` takes `{}` with JSON content type and allowed Origin; the owner may cancel `REQUESTED`, `MATCHED`, `ACCEPTED`, or `DRIVER_ARRIVED` before start. Matched and accepted cancellation releases its seat; an empty pre-start pool becomes CANCELLED. Repeated or post-start cancellation returns 409 `INVALID_TRANSITION`. All four ride operations require a passenger session; driver sessions get 403.

## Phase 4 matching behavior

Matching is a system action during request creation; no passenger or driver matching endpoint exists. A request remains `REQUESTED` with 201 when Bullet is offline, full, or there is no compatible OPEN pool and Bullet is busy. Active pools are considered by `(created_at, id)`; if an eligible vehicle has no active pool, the system creates an OPEN pool. All booked v1 destinations use the approved Banani compatibility rule. Seat release, going online and completing a pool synchronously retry waiting requests. The passenger response contains only that passenger's status and fare, never other members' details.

## Phase 5 driver contract

All `/driver` endpoints require a DRIVER session and select only that driver's vehicle/pools. Mutations require an allowed `Origin`, JSON content type and strictly validated body. `GET /driver/vehicle` returns `{ id, name, capacitySeats, isOnline }`; `PATCH /driver/vehicle/availability` takes `{ "isOnline": true|false }` and returns the same shape. Offline during any nonterminal pool, including OPEN, returns 409 `VEHICLE_BUSY`; online synchronously retries waiting rides after committing. Repeating an availability value is safe.

`GET /driver/pools?scope=open|active|history&limit=20&offset=0` defaults to active and bounds limit 1..50, offset 0..10000; `GET /driver/pools/:id` returns the assigned pool or 404. Each pool includes `id`, `vehicleId`, `pickupAreaId`, `status`, `createdAt`, `acceptedAt`, `arrivedAt`, `startedAt`, `completedAt`, `cancelledAt`, `members`, `events`. Each member includes `rideRequestId`, `passengerName`, `pickupAreaId`, `destinationAreaId`, `seats`, `status`, `estimatedFarePoysha`, `finalFarePoysha` (null before acceptance), `releasedAt`. History retains released members. No passenger session/password data is exposed.

`POST /driver/pools/:id/accept|arrive|start|complete` each takes `{}` and returns the updated pool detail. Accept atomically moves OPEN → ACCEPTED and active requests MATCHED → ACCEPTED, freezes membership and inserts one immutable fare snapshot per active request. Accepted pooled fare is `seats * (basePerSeat + zonePerSeat - roundHalfUp(zonePerSeat * 20 / 100))` for at least two distinct active requests; one request alone pays the standalone fare. For one seat, Nusrat pays 11400 and Rafiq 14600 poysha when pooled. Arrival moves ACCEPTED → ARRIVED and requests to DRIVER_ARRIVED; start moves ARRIVED → IN_PROGRESS and requests to STARTED; complete moves IN_PROGRESS → COMPLETED and requests to COMPLETED. Repeated, skipped, empty or stale transitions return 409 `INVALID_TRANSITION` without partial writes. Completion retries waiting rides after commit if the vehicle is online.
