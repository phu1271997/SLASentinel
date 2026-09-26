#!/usr/bin/env python3
"""Live end-to-end walkthrough of SLASentinel on studionet with 3 real wallets.

    source ~/.genlayer/env.sh
    python3 scripts/e2e_studionet.py

Wallets (from ~/.genlayer/keys.env):
    GENLAYER_PRIVATE_KEY    -> admin / deployer
    GENLAYER_PRIVATE_KEY_2  -> provider (registers a program, may challenge)
    GENLAYER_PRIVATE_KEY_3  -> customer (files claims, withdraws)

Exercises the full flow with REAL AI + web consensus:
  register_program -> file_claim (real incident evidence) -> adjudicate_claim
  -> settle_claim (after window) -> withdraw ; plus a bogus claim -> REJECTED.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

from genlayer_py import create_account, create_client
from genlayer_py.chains import studionet

ROOT = Path(__file__).resolve().parent.parent
GEN = 10**18

# Commit-pinned policy + evidence living in this very repo.
SLA_URL = "https://raw.githubusercontent.com/phu1271997/SLASentinel/17902d3d1b1407b2546f73ce3d2a65d0497c521e/docs/SLA.md"
INCIDENT_URL = "https://raw.githubusercontent.com/phu1271997/SLASentinel/17902d3d1b1407b2546f73ce3d2a65d0497c521e/docs/incident-2026-08.md"
# Unrelated content -> should be REJECTED as non-breaching evidence.
BOGUS_URL = "https://raw.githubusercontent.com/phu1271997/SLASentinel/17902d3d1b1407b2546f73ce3d2a65d0497c521e/docs/SLA.md"

WINDOW = 45  # short challenge window so we can settle within the run


def addr():
    d = json.loads((ROOT / "deployments.json").read_text())
    return d["address"]


def w(client, account, fn, args, value=0, label=""):
    print(f"  -> {label or fn} ...", flush=True)
    tx = client.write_contract(address=CONTRACT, function_name=fn, args=args,
                               account=account, value=value)
    client.wait_for_transaction_receipt(transaction_hash=tx, status="FINALIZED",
                                        interval=3000, retries=80)
    return tx


def r(client, fn, args):
    return client.read_contract(address=CONTRACT, function_name=fn, args=args)


CONTRACT = addr()


def main() -> int:
    k1 = os.environ.get("GENLAYER_PRIVATE_KEY")
    k2 = os.environ.get("GENLAYER_PRIVATE_KEY_2")
    k3 = os.environ.get("GENLAYER_PRIVATE_KEY_3")
    if not all([k1, k2, k3]) or any("REPLACE_ME" in (x or "") for x in [k1, k2, k3]):
        print("ERROR: need GENLAYER_PRIVATE_KEY, _2, _3. Run: source ~/.genlayer/env.sh", file=sys.stderr)
        return 1

    admin = create_account(k1)
    provider = create_account(k2)
    customer = create_account(k3)
    client = create_client(chain=studionet, account=admin)

    print("=" * 60)
    print(f"SLASentinel e2e — contract {CONTRACT}")
    print(f"provider={provider.address}\ncustomer={customer.address}")
    print("=" * 60)

    # 1. Provider registers a program
    print("\n[1] provider registers program (reserve 10 GEN, target 99.9%)")
    w(client, provider, "register_program",
      ["Acme Cloud API", SLA_URL, 99900, 250, WINDOW], value=10 * GEN,
      label="register_program")
    programs = json.loads(r(client, "list_programs", [0, 50]))
    pid = programs[-1]["program_id"]
    print(f"    program_id={pid}, reserve={int(programs[-1]['reserve'])//GEN} GEN")

    # 2. Customer files a legitimate downtime claim
    print("\n[2] customer files claim (2026-08, 492 min down, real incident evidence)")
    w(client, customer, "file_claim", [pid, "2026-08", 492, INCIDENT_URL],
      value=1 * GEN, label="file_claim")
    claims = json.loads(r(client, "list_claims", ["ALL", 0, 50]))
    cid = claims[-1]["claim_id"]
    print(f"    claim_id={cid}, state={claims[-1]['state']}")

    # 3. Run AI consensus adjudication (real LLM + web fetch on validators)
    print("\n[3] adjudicate_claim -> GenLayer validator consensus (this is slow)")
    w(client, customer, "adjudicate_claim", [cid], label="adjudicate_claim")
    c = json.loads(r(client, "get_claim", [cid]))
    print(f"    VERDICT={c['verdict']} TIER={c['tier']} conf={c['confidence']} state={c['state']}")
    print(f"    reason: {c['reason'][:280]}")
    print(f"    credit_amount={int(c['credit_amount'])/GEN} GEN")

    # 4. Settle after the challenge window, then customer withdraws
    if c["state"] == "CHALLENGE_WINDOW":
        print(f"\n[4] waiting out the {WINDOW}s challenge window, then settle_claim")
        time.sleep(WINDOW + 8)
        w(client, customer, "settle_claim", [cid], label="settle_claim")
        c = json.loads(r(client, "get_claim", [cid]))
        print(f"    state={c['state']}")
        bal = r(client, "get_balance", [customer.address])
        print(f"    customer claimable balance = {int(bal)/GEN} GEN")
        if int(bal) > 0:
            print("\n[5] customer withdraw()")
            w(client, customer, "withdraw", [], label="withdraw")
            bal2 = r(client, "get_balance", [customer.address])
            print(f"    balance after withdraw = {int(bal2)/GEN} GEN")

    # 6. A bogus claim with non-breaching evidence -> expect REJECTED
    print("\n[6] customer files a bogus claim (policy page as 'evidence') -> expect REJECTED")
    w(client, customer, "file_claim", [pid, "2026-09", 5, BOGUS_URL],
      value=1 * GEN, label="file_claim(bogus)")
    claims = json.loads(r(client, "list_claims", ["ALL", 0, 50]))
    bid = claims[-1]["claim_id"]
    w(client, customer, "adjudicate_claim", [bid], label="adjudicate_claim(bogus)")
    b = json.loads(r(client, "get_claim", [bid]))
    print(f"    VERDICT={b['verdict']} state={b['state']}")
    print(f"    reason: {b['reason'][:240]}")

    print("\n[stats]", r(client, "get_stats", []))
    print("\nE2E COMPLETE.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
