# Dhaka Tesla Pool: approved product decisions

This document records decisions made against the RoBenDevs PRD before implementation. The PRD remains authoritative. See [architecture.md](architecture.md) and [api.md](api.md) for implementation contracts.

## Cast and scope

- Jashim drives Bullet, a three **passenger** seat Tesla. Nusrat, Rafiq, and Shirin are passengers. Use those names consistently in seed records, tests, README, and demo.
- Initial bookable routes are Banani to Mohakhali and Banani to Gulshan 1. These are named zones, not real road distance estimates or routing claims. Add another area only with an explicit route tariff and compatibility rule.
- Requests reserve 1 to 3 passenger seats. A passenger can have only one nonterminal request at a time. The driver has one vehicle and may have only one nonterminal pool per vehicle.
- Normal demo: all three named passengers can occupy one seat each in Bullet before Jashim accepts. The separate concurrency test starts with exactly two seats reserved and makes two simultaneous claims for the final seat.

## Deterministic matching

The system creates a request in `REQUESTED` and attempts allocation synchronously. It can join a pool iff the vehicle is online, the pool is `OPEN`, pickups are identical, capacity is sufficient, and the destination is either identical to all other active destinations or the pickup is Banani and every destination is Mohakhali or Gulshan 1. Consider eligible pools by `(created_at, id)` ascending; create a new `OPEN` pool only if an eligible driver/vehicle is idle. Matching is a **system** decision; acceptance is a separate **driver** action. Pools close to new riders at acceptance. A request without capacity/driver is successfully created and stays `REQUESTED`/waiting, never partially allocated. Going online, a released pre-start seat, and pool completion trigger synchronous retry of waiting requests; no background queue.

## Frozen fare model (v1)

Per-seat base: 5,000 poysha (BDT 50). Banani to Mohakhali zone charge: 8,000 poysha (BDT 80). Banani to Gulshan 1 zone charge: 12,000 poysha (BDT 120). If at least two *different active passenger requests* share the pool **at acceptance**, discount each rider by 20% of their zone charge per seat. A booking with multiple seats by one passenger alone does not qualify. For future fractional-poysha discounts, round half-up to one poysha. `fare = seats * (base + zone charge - discount)`. Store and return **integer poysha**; display taka with two decimal places. No floating-point money is stored.

Nusrat one seat: standalone 5,000 + 8,000 = 13,000 poysha (BDT 130); pooled 5,000 + 8,000 - 1,600 = **11,400 poysha (BDT 114)**. Rafiq one seat: standalone 5,000 + 12,000 = 17,000 poysha (BDT 170); pooled 5,000 + 12,000 - 2,400 = **14,600 poysha (BDT 146)**. Shirin, if Banani to Mohakhali, has the same one-seat calculation as Nusrat.

Creation stores a standalone estimate, the matched quote is provisional, and driver acceptance atomically commits individual immutable fare snapshots with components and tariff version. Cancelled-before-start cash due is zero; retain any previous fare quote for history. Remaining accepted passengers retain their committed price after a cancellation. MVP payment choice: cash; no gateway or verified collection.

## State and access decisions

Request states: `REQUESTED`, `MATCHED`, `ACCEPTED`, `DRIVER_ARRIVED`, `STARTED`, `COMPLETED`, `CANCELLED`. Pool states: `OPEN`, `ACCEPTED`, `ARRIVED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`. See [architecture.md](architecture.md) for exhaustive transitions and permissions. A passenger may cancel their own `REQUESTED`, `MATCHED`, `ACCEPTED`, or `DRIVER_ARRIVED` request, releasing seats; they cannot cancel after `STARTED`. The pool retains its state if another active member remains. Cancelling its final member before start cancels the pool. Driver cancellation is outside MVP.

Jashim may go offline only without a nonterminal pool. The driver sees assigned OPEN-pool members in an explicit **Relevant Ride Requests** UI section. Passenger views reveal only that passenger's fare and status, never another passenger's private details.

## Security, history, operations

Passengers self-register; Jashim's driver account is seeded. Use a maintained Argon2id implementation (`argon2` npm package) for passwords, with unique salts provided by the library; never log or store plaintext. Sessions use cryptographically random 32-byte opaque tokens, set in an `HttpOnly`, `SameSite=Lax`, `Path=/` cookie; `Secure` in production (HTTPS), false only for local HTTP. No JavaScript access to session tokens. Store only a SHA-256 hash of each token in PostgreSQL; compare by hashed lookup. Expire after seven days; revoke current session on logout, reject expired/revoked sessions, rotate token on login. Mutations additionally validate same-origin `Origin` and JSON content type. Avoid cross-origin credentialed API calls by proxying `/api` through the web origin. Document HTTPS requirement for public deployment.

Append state events with actor (or system), affected request/pool, old/new states, reason and timestamp in the same transaction as state changes. Preserve membership and immutable accepted fare snapshots. Do not expose secrets or raw credentials in seed instructions. Use free hosting only; when no suitable free backend/database host exists, record the reason and offer reproducible Docker deployment.

## Current intentionally deferred work

Phase 1 has no auth implementation, ride schema, matching, fare logic, passenger/driver product screens, or live deployment. Git flow: real `feature/*` work into `master`, then `pre-release`, finally `release/v1.0.0` cut from `pre-release` only after release checks. Every commit uses `<type>(<scope>): <short description>`.
