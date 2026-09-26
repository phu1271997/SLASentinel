# Acme Cloud API — Service Level Agreement (Reference Policy)

> This document is the machine-readable SLA that GenLayer validators fetch and
> reason over when adjudicating a claim in **SLASentinel**. A program pins this
> file to an exact GitHub **commit SHA**, so the terms an AI arbiter reads can
> never be silently edited after a claim is filed.

## 1. Monthly Uptime Commitment

Acme Cloud API commits to a **Monthly Uptime Percentage of at least 99.9%**
("the Target") for the production API endpoints, measured per calendar month.

**Monthly Uptime Percentage** = `(total minutes in month − Downtime minutes) / total minutes in month × 100`.

**Downtime** is any period in which the API returns 5xx errors on more than 5% of
requests, or is unreachable, as shown by an independent monitor or a public
incident report, and which is attributable to the provider (not the customer's
network, misuse, or a scheduled maintenance window announced ≥48h in advance).

## 2. Downtime Budget

At a 99.9% Target, the permitted monthly downtime budget is approximately
**43 minutes** in a 30-day month. Any confirmed provider-attributable downtime
**beyond** that budget constitutes a **breach**.

## 3. Service-Credit Severity Tiers

When a breach is confirmed, the customer is owed a service credit sized to the
realized impact:

| Tier | Condition | Service credit |
|------|-----------|----------------|
| **CRITICAL** | Full or near-full outage, or realized monthly uptime below 99.0% (≈ >7h down) | 15% of the reserve |
| **MAJOR** | Significant partial outage clearly beyond the budget (uptime 99.0%–99.7%) | 7% of the reserve |
| **MINOR** | Marginal breach just past the budget (uptime 99.7%–99.9%) | 2% of the reserve |

## 4. Evidence & Attribution

A valid claim must point to **primary evidence**: an independent uptime monitor
export, a public status-page incident permalink, or an incident post-mortem.
Self-reported downtime with no verifiable source, evidence for an outage caused
by the customer, or evidence that does not actually exceed the budget is
**rejected**, and the claimant's bond is forfeited to the reserve.

## 5. Immutability

These terms are fixed at the pinned commit for the lifetime of any claim that
references them. Amendments require publishing a new commit and re-registering
the program.
