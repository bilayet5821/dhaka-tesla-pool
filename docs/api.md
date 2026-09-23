# Planned REST API contract (not yet implemented)

Base prefix `/api/v1`; JSON success `{ "data": ... }`, error `{ "error": { "code", "message", "details"? } }`. Use integer-poysha monetary fields, bounded pagination, session cookie authentication and server-side ownership checks. Keep request IDs in a response header.

| Method and path | Principal | Purpose |
| --- | --- | --- |
| `GET /health/live`, `GET /health/ready` | public | Process liveness and DB/schema readiness |
| `POST /auth/register`, `/auth/login`, `/auth/logout`; `GET /auth/me` | public or current user | Passenger signup, session, revocation, own profile |
| `GET /areas`; `POST /fares/estimate` | public; passenger | Available zones; standalone fare estimate |
| `POST /ride-requests`; `GET /ride-requests?scope=active|history`; `GET /ride-requests/:id`; `POST /ride-requests/:id/cancel` | passenger | Create, inspect, list and cancel **own** requests |
| `GET /driver/vehicle`; `PATCH /driver/vehicle/availability` | assigned driver | View Bullet and switch online/offline if safe |
| `GET /driver/pools?scope=open|active|history`; `GET /driver/pools/:id` | assigned driver | Show pool and **Relevant Ride Requests** for OPEN pools |
| `POST /driver/pools/:id/accept`, `/arrive`, `/start`, `/complete` | assigned driver | Apply exact driver-controlled pool transitions |

Validation: Zod at HTTP boundaries; request seats 1..3, distinct supported pickup/destination, allowed route, and `CASH`; database constraints provide defense in depth. Proposed errors: 400 `INVALID_INPUT`, 401 `AUTH_REQUIRED`/`INVALID_CREDENTIALS`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `INVALID_TRANSITION`/`ACTIVE_REQUEST_EXISTS`/`VEHICLE_BUSY`, 429 `RATE_LIMITED`, 500 `INTERNAL_ERROR`, 503 `DEPENDENCY_UNAVAILABLE`. Automatic matching with no seat is **201**, request state `REQUESTED`, allocation waiting; it is not an overbooking or 409. Do not leak SQL, cookies or secrets. Driver UI must show loading/error/empty states, including an empty Relevant Ride Requests section.
