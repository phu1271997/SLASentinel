# SLASentinel — Autonomous SLA Service-Credit Arbiter on GenLayer

> **In most SLAs, the provider decides whether it breached its own uptime
> promise.** SLASentinel takes that decision away from the provider and gives it
> to GenLayer validator consensus: AI validators fetch the commit-pinned SLA
> policy and the customer's incident evidence *directly on-chain*, judge whether
> a breach occurred and how severe it was, and release the service credit
> automatically — no provider sign-off.

**Live app:** _(Vercel URL — see below)_
**Contract (studionet):** `0xDA88AE54259213fDC1e5E11Eda54F2c2881FED07`
**Explorer:** https://genlayer-explorer.vercel.app/address/0xDA88AE54259213fDC1e5E11Eda54F2c2881FED07
**Network:** GenLayer **studionet** (chain id `61999`), via GenLayer Studio.

---

## Why this dies without GenLayer

The core action is a **subjective, money-bearing judgment**: *"Given this SLA
document and this incident evidence, was the uptime target breached, and by how
much?"* That requires (1) reading a policy and messy real-world evidence off the
open web, and (2) LLM reasoning to weigh attribution and severity. A Solidity
contract can do neither without a trusted oracle — and a trusted oracle is
exactly the single point of discretion we are removing. Strip out the AI + web
layer and there is no product, only a spreadsheet the provider still controls.

## How it works

```
Provider  ──register_program(reserve, SLA@commit, target)──►  SLASentinel (studionet)
Customer  ──file_claim(month, downtime, evidenceURL, bond)──►      │
                                                                   ▼
                          adjudicate_claim()  ── gl.vm.run_nondet ──┐
                            leader_fn:  web.get(SLA@commit)         │  AI validators
                                        web.get(evidenceURL)        │  reach consensus
                                        exec_prompt(verdict+tier)   │  on the VERDICT
                            validator_fn: compare verdict + tier ───┘
                                                                   ▼
             UPHELD → challenge window → settle → pull-payout credit to customer
             REJECTED → customer bond slashed into the provider reserve
```

1. **Register.** A provider locks a service-credit **reserve** (≥ 5 GEN) and pins
   its SLA to an exact GitHub **commit SHA** (HTTPS + commit-hash enforced
   on-chain, with basic SSRF hardening). The pinned terms can never be edited
   out from under a filed claim.
2. **File a claim.** A customer bonds ≥ 1 GEN and submits the affected month,
   claimed downtime, and a **primary-evidence URL** (status page / monitor
   export / post-mortem).
3. **Adjudicate.** `adjudicate_claim` runs a non-deterministic block on the
   validator set: it fetches the SLA policy **and** the evidence on-chain, then
   asks each validator's LLM for `{verdict, tier, confidence, reason}`.
   Consensus is reached on **meaning** — the custom `validator_fn` requires
   validators to agree on the **verdict** and, when upheld, the **severity
   tier**; wording of `reason` is ignored.
4. **Challenge.** If upheld, a **7-day challenge window** opens (configurable per
   program). The provider may post a **bonded rebuttal** (≥ 2 GEN) with
   counter-evidence, which re-runs consensus over all three sources. A losing
   rebuttal forfeits the provider's bond to the customer; a winning one overturns
   the claim.
5. **Settle & withdraw.** After the window (or a failed challenge) the service
   credit — tiered CRITICAL 15% / MAJOR 7% / MINOR 2% of reserve, minus a small
   protocol fee — plus the original bond is credited to the customer via a
   **pull pattern** (`settle_claim` → `withdraw`).

### Consensus that checks meaning, not shape (Axis 2)

```python
def validator_fn(leader_res) -> bool:
    if not isinstance(leader_res, gl.vm.Return):
        return False
    leader = leader_res.calldata
    mine = leader_fn()                       # validator re-derives independently
    if mine["verdict"] != leader["verdict"]: # ✅ agree on the DECISION
        return False
    if leader["verdict"] == "UPHELD" and mine["tier"] != leader["tier"]:
        return False                         # ✅ and the payout tier
    return (mine["confidence"] >= 60) == (leader["confidence"] >= 60)
```

Two validators that phrase `reason` differently still agree; two validators that
reach different verdicts (or different payout tiers) do **not** — exactly the
line SLASentinel must hold to be trustworthy.

### Advanced non-determinism (Axis 2 → 5)

- **Multi-source web cross-check:** every adjudication fetches *two* independent
  on-chain sources (policy + evidence), and a challenge fetches a *third*
  (rebuttal), forcing the LLM to reconcile them rather than trust one input.
- **Bonded challenge / appeal flow** implemented at the contract layer with a
  re-consensus round and a confidence band that separates a settle from an
  escalate.

## Edge cases handled (each with `UserError`)

- Non-HTTPS or non-commit-pinned SLA URL → rejected at registration.
- Reserve < 5 GEN, bond < 1 GEN, challenge bond < 2 GEN → rejected.
- Web fetch failure / dead URL → captured as `[FETCH_ERROR ...]` and weighed as
  unverifiable (leads to rejection, not a crash).
- Zero / dust value, closed program, double-adjudication, challenge after the
  window, challenge by a non-provider → all revert.
- `withdraw` with a zero balance → reverts. Payouts use a pull pattern so a
  failed transfer can never wedge settlement.

## Repository layout

```
contracts/sla_sentinel.py     # the GenLayer Intelligent Contract
docs/SLA.md                   # reference SLA policy (commit-pinned in demos)
tests/                        # gltest: happy path + adversarial + mocked consensus
scripts/deploy_studionet.py   # schema-gated deploy + writes frontend/.env
scripts/e2e_studionet.py      # live multi-wallet end-to-end exerciser
frontend/                     # Vite + React + Tailwind dApp (genlayer-js)
deployments.json              # deployed address + tx + explorer link
```

## Deploy to studionet (step by step)

```bash
# 1. Load the funded studionet deployer + demo wallets
source ~/.genlayer/env.sh

# 2. Deploy (runs a schema pre-flight, writes deployments.json + frontend/.env)
python3 scripts/deploy_studionet.py

# 3. (optional) Exercise the whole flow live with 3 wallets
python3 scripts/e2e_studionet.py
```

Verify on-chain: open the deploy tx in the Explorer and confirm **`Result:
SUCCESS`** (not merely `Status: FINALIZED`).

## Run the frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

The dApp signs with **MetaMask** (no private key in the bundle), auto-switches to
studionet on connect, shows a loading state while consensus runs, and renders the
AI's `reason` plus a link to the transaction on the Explorer.

> **Wallet rule:** connect a wallet **already funded with GEN on studionet**
> (fund it from the Studio **Accounts** panel). studionet and testnet are
> separate networks; nothing here touches a testnet faucet.

## Tests

```bash
source ~/.genlayer/env.sh
cd tests && gltest --network studionet
```

## Tech

Python Intelligent Contract (GenVM) · `gl.vm.run_nondet` semantic consensus ·
`gl.nondet.web.get` / `exec_prompt` · genlayer-js · Vite + React + Tailwind ·
deployed on GenLayer studionet.

## License

MIT © 2026
