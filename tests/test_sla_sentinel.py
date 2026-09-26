"""SLASentinel — happy path + adversarial / edge-case tests.

Deterministic paths (registration, validation, pull-payout guards) run without
a live LLM. The consensus adjudication test installs LLM + web mocks first
(R17) so the nondet transaction finalizes instead of surfacing a state error.
"""
import json

import pytest
from gltest import get_contract_factory

GEN = 10**18
PINNED_SLA = "https://raw.githubusercontent.com/example/acme/436d7f2abcdef1234567890abcdef1234567890a/docs/SLA.md"


def _deploy(admin):
    return get_contract_factory("Contract").deploy(account=admin)


def _install_mocks(contract, verdict="UPHELD", tier="CRITICAL", confidence=90):
    """Install deterministic LLM + web mocks for nondet consensus (R17)."""
    payload = json.dumps(
        {"verdict": verdict, "tier": tier, "confidence": confidence,
         "reason": "Mocked arbiter verdict for tests."}
    )
    try:
        contract.provider.make_request(
            method="sim_installMocks",
            params={
                "llm_mocks": {".*": payload},
                "web_mocks": {".*": {"status": 200, "body": "Incident: full outage 8h"}},
            },
        )
    except Exception:
        pass  # localnet without the sim endpoint — deterministic tests still run


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------
def test_register_program_and_view(admin, provider):
    c = _deploy(admin)
    pid = c.connect(provider).register_program(
        args=["Acme Cloud API", PINNED_SLA, 99900, 250, 90]
    ).transact(value=5 * GEN)

    programs = json.loads(c.list_programs(args=[0, 10]).call())
    assert len(programs) == 1
    p = programs[0]
    assert p["service_name"] == "Acme Cloud API"
    assert p["uptime_target_bps"] == 99900
    assert int(p["reserve"]) == 5 * GEN
    assert p["open"] is True


def test_file_claim_flow(admin, provider, customer):
    c = _deploy(admin)
    pid = c.connect(provider).register_program(
        args=["Acme Cloud API", PINNED_SLA, 99900, 250, 90]
    ).transact(value=5 * GEN)
    cid = c.connect(customer).file_claim(
        args=[str(pid) if not isinstance(pid, str) else pid, "2026-08", 480,
              "https://status.example.com/incidents/2026-08-outage"]
    ).transact(value=1 * GEN)
    claims = json.loads(c.list_claims(args=["ALL", 0, 10]).call())
    assert len(claims) == 1
    assert claims[0]["state"] == "OPEN"
    assert claims[0]["claimed_downtime_min"] == 480


# ---------------------------------------------------------------------------
# Edge cases / adversarial (deterministic reverts)
# ---------------------------------------------------------------------------
def test_reserve_below_minimum_rejected(admin, provider):
    c = _deploy(admin)
    with pytest.raises(Exception):
        c.connect(provider).register_program(
            args=["Cheap", PINNED_SLA, 99900, 250, 90]
        ).transact(value=1 * GEN)  # < 5 GEN


def test_non_commit_pinned_sla_rejected(admin, provider):
    c = _deploy(admin)
    with pytest.raises(Exception):
        c.connect(provider).register_program(
            args=["NoPin", "https://raw.githubusercontent.com/example/acme/main/SLA.md",
                  99900, 250, 90]
        ).transact(value=5 * GEN)


def test_bond_below_minimum_rejected(admin, provider, customer):
    c = _deploy(admin)
    pid = c.connect(provider).register_program(
        args=["Acme", PINNED_SLA, 99900, 250, 90]
    ).transact(value=5 * GEN)
    with pytest.raises(Exception):
        c.connect(customer).file_claim(
            args=[str(pid), "2026-08", 480, "https://status.example.com/x"]
        ).transact(value=1)  # dust bond


def test_withdraw_nothing_reverts(admin, customer):
    c = _deploy(admin)
    with pytest.raises(Exception):
        c.connect(customer).withdraw().transact()


# ---------------------------------------------------------------------------
# Consensus adjudication (mocked LLM + web)
# ---------------------------------------------------------------------------
def test_adjudicate_upheld_opens_challenge_window(admin, provider, customer):
    c = _deploy(admin)
    _install_mocks(c, verdict="UPHELD", tier="CRITICAL", confidence=90)
    pid = c.connect(provider).register_program(
        args=["Acme", PINNED_SLA, 99900, 250, 90]
    ).transact(value=10 * GEN)
    cid = c.connect(customer).file_claim(
        args=[str(pid), "2026-08", 480, "https://status.example.com/incident"]
    ).transact(value=1 * GEN)
    c.connect(customer).adjudicate_claim(args=[str(cid)]).transact()

    claim = json.loads(c.get_claim(args=[str(cid)]).call())
    assert claim["verdict"] == "UPHELD"
    assert claim["tier"] == "CRITICAL"
    assert claim["state"] == "CHALLENGE_WINDOW"
    assert int(claim["credit_amount"]) > 0
