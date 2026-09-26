# Acme Cloud API — Incident Post-Mortem — 2026-08

**Status:** Resolved · **Severity:** SEV-1 (full outage) · **Month affected:** 2026-08

## Summary

On **2026-08-14** the Acme Cloud API production endpoints experienced a **complete
outage lasting 8 hours 12 minutes (492 minutes)**. During the incident, **100% of
API requests returned HTTP 5xx or timed out**. Root cause was a failed database
failover in the provider's primary region — fully attributable to Acme, not to
any customer or to scheduled maintenance (no maintenance window was announced).

## Impact on monthly uptime

- Total minutes in August (31 days): 44,640
- Confirmed downtime: 492 minutes
- Realized monthly uptime: (44,640 − 492) / 44,640 = **98.90%**
- Contractual target: **99.9%** (downtime budget ≈ 43 minutes)

Realized uptime of 98.90% is **far below** the 99.9% target and below the 99.0%
CRITICAL threshold in the SLA. Downtime exceeded the monthly budget by more than
**11×**.

## Independent verification

- Third-party monitor (StatusCake) recorded the endpoint DOWN 08:03–16:15 UTC.
- Public status page incident #4471 posted at 08:07 UTC, resolved 16:20 UTC.

## Timeline (UTC)

- 08:03 — primary DB failover initiated, replicas not promoted
- 08:07 — status page updated: "Major outage — API unavailable"
- 12:40 — mitigation begins, partial recovery
- 16:15 — full service restored
