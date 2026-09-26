# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *

from dataclasses import dataclass
import json


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _run_nondet(leader_fn, validator_fn):
    """Prefer the sandboxed run_nondet; fall back gracefully on older Studio builds.

    Per project rule D3 we default to gl.vm.run_nondet (sandboxed validator).
    Some Studio builds only expose run_nondet_unsafe; in that case we fall back
    and note it — this is a runtime limitation, not a design choice.
    """
    fn = (
        getattr(gl.vm, "run_nondet", None)
        or getattr(gl.vm, "run_nondet_default", None)
        or gl.vm.run_nondet_unsafe
    )
    return fn(leader_fn, validator_fn)


def _addr_str(addr: Address) -> str:
    try:
        return addr.as_hex
    except Exception:
        return str(addr)


def _now_epoch() -> bigint:
    try:
        return bigint(int(gl.vm.get_timestamp().timestamp()))
    except Exception:
        return bigint(0)


def _is_https_commit_pinned(url: str) -> bool:
    """SLA policy must be HTTPS and pinned to an immutable GitHub commit SHA.

    We accept github.com / raw.githubusercontent.com URLs that embed a 40-hex
    (or 7+-hex short) commit sha so the policy the AI reads can never be edited
    out from under a filed claim.
    """
    u = url.strip().lower()
    if not u.startswith("https://"):
        return False
    if ("github.com/" not in u) and ("raw.githubusercontent.com/" not in u):
        return False
    # crude SSRF hardening: no ip/userinfo/port/localhost
    if "@" in u or "localhost" in u or "127.0.0.1" in u:
        return False
    # require a hex commit segment of length >= 7
    parts = url.replace("://", "/").split("/")
    for p in parts:
        seg = p.strip()
        if 7 <= len(seg) <= 40 and all(c in "0123456789abcdef" for c in seg.lower()):
            return True
    return False


# Credit tier -> basis points of the program reserve released to the customer.
# CRITICAL 15%, MAJOR 7%, MINOR 2%. Values are deliberate service-credit sizes.
_TIER_BPS = {"CRITICAL": 1500, "MAJOR": 700, "MINOR": 200}


@allow_storage
@dataclass
class Program:
    provider: str
    service_name: str
    sla_url: str               # commit-pinned SLA policy
    uptime_target_bps: u32     # e.g. 99900 = 99.900%
    reserve: bigint            # locked service-credit reserve
    fee_bps: u16               # protocol fee taken on payout
    challenge_window_secs: bigint
    open: bool
    total_paid: bigint


@allow_storage
@dataclass
class Claim:
    program_id: str
    customer: str
    month: str                 # "YYYY-MM"
    claimed_downtime_min: u32
    evidence_url: str
    bond: bigint
    state: str                 # OPEN | CHALLENGE_WINDOW | UPHELD | REJECTED | SETTLED
    verdict: str               # "" | UPHELD | REJECTED
    tier: str                  # "" | CRITICAL | MAJOR | MINOR
    reason: str
    confidence: u8
    credit_amount: bigint
    challenge_deadline: bigint
    rebuttal_url: str
    created_at: bigint


class Contract(gl.Contract):
    admin: Address
    next_program_id: bigint
    next_claim_id: bigint
    programs: TreeMap[str, Program]
    claims: TreeMap[str, Claim]
    balances: TreeMap[str, bigint]      # pull-pattern withdrawable balances
    fee_pool: bigint

    MIN_RESERVE = bigint(5 * 10**18)     # 5 GEN
    MIN_BOND = bigint(1 * 10**18)        # 1 GEN
    MIN_CHALLENGE_BOND = bigint(2 * 10**18)  # 2 GEN
    DEFAULT_WINDOW = bigint(7 * 24 * 3600)   # 7 days

    def __init__(self):
        self.admin = gl.message.sender_address
        self.next_program_id = bigint(1)
        self.next_claim_id = bigint(1)
        self.fee_pool = bigint(0)

    # -----------------------------------------------------------------
    # Provider side
    # -----------------------------------------------------------------
    @gl.public.write.payable
    def register_program(
        self,
        service_name: str,
        sla_url: str,
        uptime_target_bps: int,
        fee_bps: int,
        challenge_window_secs: int,
    ) -> str:
        if gl.message.value < u256(int(self.MIN_RESERVE)):
            raise gl.vm.UserError("Reserve must be at least 5 GEN")
        if not service_name or len(service_name.strip()) == 0:
            raise gl.vm.UserError("Service name required")
        if len(service_name) > 120:
            raise gl.vm.UserError("Service name too long")
        if not _is_https_commit_pinned(sla_url):
            raise gl.vm.UserError(
                "SLA URL must be HTTPS GitHub/raw URL pinned to a commit SHA"
            )
        if uptime_target_bps <= 0 or uptime_target_bps >= 100000:
            raise gl.vm.UserError("uptime_target_bps must be in (0, 100000)")
        if fee_bps < 0 or fee_bps > 1000:
            raise gl.vm.UserError("fee_bps must be 0..1000 (<=10%)")

        window = bigint(challenge_window_secs) if challenge_window_secs > 0 else self.DEFAULT_WINDOW

        pid_int = int(self.next_program_id)
        self.next_program_id = bigint(pid_int + 1)
        pid = str(pid_int)

        self.programs[pid] = Program(
            provider=_addr_str(gl.message.sender_address),
            service_name=service_name.strip(),
            sla_url=sla_url.strip(),
            uptime_target_bps=u32(uptime_target_bps),
            reserve=bigint(gl.message.value),
            fee_bps=u16(fee_bps),
            challenge_window_secs=window,
            open=True,
            total_paid=bigint(0),
        )
        return pid

    @gl.public.write.payable
    def fund_program(self, program_id: str) -> None:
        if program_id not in self.programs:
            raise gl.vm.UserError("Program not found")
        if gl.message.value == u256(0):
            raise gl.vm.UserError("Funding must be positive")
        p = self.programs[program_id]
        p.reserve = p.reserve + bigint(gl.message.value)

    @gl.public.write
    def close_program(self, program_id: str) -> None:
        if program_id not in self.programs:
            raise gl.vm.UserError("Program not found")
        p = self.programs[program_id]
        if _addr_str(gl.message.sender_address).lower() != p.provider.lower():
            raise gl.vm.UserError("Only provider can close program")
        p.open = False

    # -----------------------------------------------------------------
    # Customer side
    # -----------------------------------------------------------------
    @gl.public.write.payable
    def file_claim(
        self,
        program_id: str,
        month: str,
        claimed_downtime_min: int,
        evidence_url: str,
    ) -> str:
        if program_id not in self.programs:
            raise gl.vm.UserError("Program not found")
        p = self.programs[program_id]
        if not p.open:
            raise gl.vm.UserError("Program is closed to new claims")
        if gl.message.value < u256(int(self.MIN_BOND)):
            raise gl.vm.UserError("Bond must be at least 1 GEN")
        if claimed_downtime_min <= 0:
            raise gl.vm.UserError("Claimed downtime must be positive")
        if not evidence_url.strip().lower().startswith("https://"):
            raise gl.vm.UserError("Evidence URL must be HTTPS")
        if len(month.strip()) < 4:
            raise gl.vm.UserError("Month must look like YYYY-MM")

        cid_int = int(self.next_claim_id)
        self.next_claim_id = bigint(cid_int + 1)
        cid = str(cid_int)

        self.claims[cid] = Claim(
            program_id=program_id,
            customer=_addr_str(gl.message.sender_address),
            month=month.strip(),
            claimed_downtime_min=u32(claimed_downtime_min),
            evidence_url=evidence_url.strip(),
            bond=bigint(gl.message.value),
            state="OPEN",
            verdict="",
            tier="",
            reason="",
            confidence=u8(0),
            credit_amount=bigint(0),
            challenge_deadline=bigint(0),
            rebuttal_url="",
            created_at=_now_epoch(),
        )
        return cid

    # -----------------------------------------------------------------
    # Consensus adjudication (the heart — runs on GenLayer validators)
    # -----------------------------------------------------------------
    def _adjudicate_prompt(
        self, sla_text: str, evidence_text: str, target_bps: int,
        month: str, downtime: int, rebuttal_text: str
    ) -> str:
        rebuttal_block = ""
        if rebuttal_text:
            rebuttal_block = f"""
PROVIDER REBUTTAL EVIDENCE (fetched on-chain, weigh against the customer claim):
{rebuttal_text[:4000]}
"""
        return f"""You are a decentralized SLA arbiter running inside a GenLayer Intelligent Contract.
You must decide, from primary evidence fetched on-chain, whether a service-level
agreement was breached in month {month}, and if so how severe the breach was.

THE SLA POLICY (commit-pinned, authoritative — read the uptime/credit terms):
{sla_text[:6000]}

CONTRACTUAL UPTIME TARGET (basis points, 100000 = 100.000%): {target_bps}

CUSTOMER-CLAIMED DOWNTIME THIS MONTH: {downtime} minutes

INCIDENT / MONITORING EVIDENCE (fetched on-chain from the customer's URL):
{evidence_text[:6000]}
{rebuttal_block}
Decide:
1. Does the evidence credibly show an outage / degradation attributable to the provider?
2. Does the observed downtime breach the contractual uptime target for the month?
3. If breached, classify severity by realized impact per the policy's own tiers:
   - CRITICAL: full/near-full outage or a breach far beyond the target
   - MAJOR:    significant partial outage clearly beyond the target
   - MINOR:    a marginal breach just past the target
Reject if the evidence is irrelevant, unverifiable, fabricated, self-reported with
no primary source, or does not actually breach the target.

RESPOND WITH ONLY VALID JSON, no markdown fence:
{{
  "verdict": "UPHELD" | "REJECTED",
  "tier": "CRITICAL" | "MAJOR" | "MINOR" | "NONE",
  "confidence": 0-100,
  "reason": "2-4 sentences citing the specific evidence and the target comparison"
}}"""

    def _fetch(self, url: str) -> str:
        try:
            res = gl.nondet.web.get(url)
            if hasattr(res, "body"):
                return res.body.decode("utf-8", errors="replace")
            return str(res)
        except Exception:
            try:
                return gl.nondet.web.render(url, mode="text")
            except Exception as e:
                return f"[FETCH_ERROR] {str(e)[:200]}"

    @gl.public.write
    def adjudicate_claim(self, claim_id: str) -> None:
        if claim_id not in self.claims:
            raise gl.vm.UserError("Claim not found")
        c = self.claims[claim_id]
        if c.state != "OPEN":
            raise gl.vm.UserError("Claim is not awaiting adjudication")
        p = self.programs[c.program_id]

        # Read storage BEFORE the nondet block, pass via closure (Rule #7).
        sla_url = p.sla_url
        evidence_url = c.evidence_url
        target_bps = int(p.uptime_target_bps)
        month = c.month
        downtime = int(c.claimed_downtime_min)

        def leader_fn():
            sla_text = self._fetch(sla_url)
            evidence_text = self._fetch(evidence_url)
            prompt = self._adjudicate_prompt(
                sla_text, evidence_text, target_bps, month, downtime, ""
            )
            return gl.nondet.exec_prompt(prompt, response_format="json")

        def validator_fn(leader_res) -> bool:
            # Consensus on MEANING: verdict + severity tier + settle/escalate band.
            if not isinstance(leader_res, gl.vm.Return):
                return False
            leader = leader_res.calldata
            if not isinstance(leader, dict) or "verdict" not in leader:
                return False
            mine = leader_fn()
            if not isinstance(mine, dict) or "verdict" not in mine:
                return False
            if str(mine["verdict"]).upper() != str(leader["verdict"]).upper():
                return False
            # If upheld, both validators must agree on the payout tier.
            if str(leader["verdict"]).upper() == "UPHELD":
                if str(mine.get("tier", "")).upper() != str(leader.get("tier", "")).upper():
                    return False
            # Confidence band must agree (>=60 settles vs escalates).
            mc = int(mine.get("confidence", 0))
            lc = int(leader.get("confidence", 0))
            if (mc >= 60) != (lc >= 60):
                return False
            return True

        result = _run_nondet(leader_fn, validator_fn)
        self._apply_verdict(claim_id, result)

    def _apply_verdict(self, claim_id: str, result) -> None:
        c = self.claims[claim_id]
        p = self.programs[c.program_id]

        verdict = str(result.get("verdict", "REJECTED")).upper()
        tier = str(result.get("tier", "NONE")).upper()
        reason = str(result.get("reason", ""))
        confidence = int(result.get("confidence", 0))
        confidence = max(0, min(100, confidence))

        c.reason = reason
        c.confidence = u8(confidence)

        if verdict != "UPHELD" or tier not in _TIER_BPS:
            # Rejected: customer bond is slashed into the program reserve.
            c.verdict = "REJECTED"
            c.tier = ""
            c.state = "REJECTED"
            p.reserve = p.reserve + c.bond
            c.bond = bigint(0)
            return

        # Upheld: size the service credit against the reserve and open the
        # provider challenge window before any funds move.
        bps = _TIER_BPS[tier]
        credit = (p.reserve * bigint(bps)) // bigint(10000)
        if credit > p.reserve:
            credit = p.reserve
        c.verdict = "UPHELD"
        c.tier = tier
        c.credit_amount = credit
        c.state = "CHALLENGE_WINDOW"
        c.challenge_deadline = _now_epoch() + p.challenge_window_secs

    # -----------------------------------------------------------------
    # Provider challenge (bonded rebuttal, re-runs consensus)
    # -----------------------------------------------------------------
    @gl.public.write.payable
    def challenge_claim(self, claim_id: str, rebuttal_url: str) -> None:
        if claim_id not in self.claims:
            raise gl.vm.UserError("Claim not found")
        c = self.claims[claim_id]
        if c.state != "CHALLENGE_WINDOW":
            raise gl.vm.UserError("Claim is not in a challenge window")
        p = self.programs[c.program_id]
        if _addr_str(gl.message.sender_address).lower() != p.provider.lower():
            raise gl.vm.UserError("Only the provider can challenge")
        if _now_epoch() > c.challenge_deadline:
            raise gl.vm.UserError("Challenge window has expired")
        if gl.message.value < u256(int(self.MIN_CHALLENGE_BOND)):
            raise gl.vm.UserError("Challenge bond must be at least 2 GEN")
        if not rebuttal_url.strip().lower().startswith("https://"):
            raise gl.vm.UserError("Rebuttal URL must be HTTPS")

        challenge_bond = bigint(gl.message.value)
        c.rebuttal_url = rebuttal_url.strip()

        sla_url = p.sla_url
        evidence_url = c.evidence_url
        rb_url = c.rebuttal_url
        target_bps = int(p.uptime_target_bps)
        month = c.month
        downtime = int(c.claimed_downtime_min)

        def leader_fn():
            sla_text = self._fetch(sla_url)
            evidence_text = self._fetch(evidence_url)
            rebuttal_text = self._fetch(rb_url)
            prompt = self._adjudicate_prompt(
                sla_text, evidence_text, target_bps, month, downtime, rebuttal_text
            )
            return gl.nondet.exec_prompt(prompt, response_format="json")

        def validator_fn(leader_res) -> bool:
            if not isinstance(leader_res, gl.vm.Return):
                return False
            leader = leader_res.calldata
            if not isinstance(leader, dict) or "verdict" not in leader:
                return False
            mine = leader_fn()
            if not isinstance(mine, dict) or "verdict" not in mine:
                return False
            return str(mine["verdict"]).upper() == str(leader["verdict"]).upper()

        result = _run_nondet(leader_fn, validator_fn)
        new_verdict = str(result.get("verdict", "UPHELD")).upper()
        new_reason = str(result.get("reason", ""))

        cust = c.customer
        if new_verdict == "REJECTED":
            # Rebuttal succeeded: breach overturned. Customer bond slashed to
            # reserve; provider recovers reserve credit + challenge bond back.
            c.state = "REJECTED"
            c.verdict = "REJECTED"
            c.reason = f"[CHALLENGE UPHELD] {new_reason}"
            p.reserve = p.reserve + c.bond + challenge_bond
            c.bond = bigint(0)
            c.credit_amount = bigint(0)
        else:
            # Rebuttal failed: the breach stands. Provider's challenge bond is
            # awarded to the customer; claim settles immediately.
            c.reason = f"[CHALLENGE FAILED] {new_reason}"
            self._credit(cust, challenge_bond)
            self._settle_upheld(claim_id)

    # -----------------------------------------------------------------
    # Settlement (after window) + pull payouts
    # -----------------------------------------------------------------
    @gl.public.write
    def settle_claim(self, claim_id: str) -> None:
        if claim_id not in self.claims:
            raise gl.vm.UserError("Claim not found")
        c = self.claims[claim_id]
        if c.state != "CHALLENGE_WINDOW":
            raise gl.vm.UserError("Claim is not awaiting settlement")
        if _now_epoch() <= c.challenge_deadline:
            raise gl.vm.UserError("Challenge window has not elapsed yet")
        self._settle_upheld(claim_id)

    def _settle_upheld(self, claim_id: str) -> None:
        c = self.claims[claim_id]
        p = self.programs[c.program_id]
        if c.state not in ("CHALLENGE_WINDOW",):
            # already settled by challenge path
            pass

        credit = c.credit_amount
        if credit > p.reserve:
            credit = p.reserve
        fee = (credit * bigint(int(p.fee_bps))) // bigint(10000)
        net = credit - fee

        p.reserve = p.reserve - credit
        p.total_paid = p.total_paid + credit
        self.fee_pool = self.fee_pool + fee

        # customer receives net service credit + original bond back
        self._credit(c.customer, net + c.bond)
        c.bond = bigint(0)
        c.state = "SETTLED"
        c.verdict = "UPHELD"

    def _credit(self, addr_s: str, amount: bigint) -> None:
        key = addr_s.lower()
        cur = self.balances[key] if key in self.balances else bigint(0)
        self.balances[key] = cur + amount

    @gl.public.write
    def withdraw(self) -> None:
        key = _addr_str(gl.message.sender_address).lower()
        bal = self.balances[key] if key in self.balances else bigint(0)
        if bal <= bigint(0):
            raise gl.vm.UserError("Nothing to withdraw")
        self.balances[key] = bigint(0)
        gl.get_contract_at(gl.message.sender_address).emit_transfer(value=u256(int(bal)))

    @gl.public.write
    def withdraw_fees(self, to: Address) -> None:
        if gl.message.sender_address != self.admin:
            raise gl.vm.UserError("Only admin")
        amt = self.fee_pool
        if amt <= bigint(0):
            raise gl.vm.UserError("No fees")
        self.fee_pool = bigint(0)
        gl.get_contract_at(to).emit_transfer(value=u256(int(amt)))

    # -----------------------------------------------------------------
    # Demo seeding (admin only)
    # -----------------------------------------------------------------
    @gl.public.write.payable
    def admin_seed_program(
        self,
        provider: str,
        service_name: str,
        sla_url: str,
        uptime_target_bps: int,
        fee_bps: int,
        challenge_window_secs: int,
    ) -> str:
        if gl.message.sender_address != self.admin:
            raise gl.vm.UserError("Only admin")
        pid_int = int(self.next_program_id)
        self.next_program_id = bigint(pid_int + 1)
        pid = str(pid_int)
        self.programs[pid] = Program(
            provider=provider,
            service_name=service_name,
            sla_url=sla_url,
            uptime_target_bps=u32(uptime_target_bps),
            reserve=bigint(gl.message.value),
            fee_bps=u16(fee_bps),
            challenge_window_secs=bigint(challenge_window_secs) if challenge_window_secs > 0 else self.DEFAULT_WINDOW,
            open=True,
            total_paid=bigint(0),
        )
        return pid

    # -----------------------------------------------------------------
    # Views
    # -----------------------------------------------------------------
    @gl.public.view
    def get_program(self, program_id: str) -> str:
        if program_id not in self.programs:
            raise gl.vm.UserError("Program not found")
        p = self.programs[program_id]
        return json.dumps(self._program_json(program_id, p))

    def _program_json(self, pid: str, p: Program) -> dict:
        return {
            "program_id": pid,
            "provider": p.provider,
            "service_name": p.service_name,
            "sla_url": p.sla_url,
            "uptime_target_bps": int(p.uptime_target_bps),
            "reserve": str(p.reserve),
            "fee_bps": int(p.fee_bps),
            "challenge_window_secs": int(p.challenge_window_secs),
            "open": p.open,
            "total_paid": str(p.total_paid),
        }

    @gl.public.view
    def list_programs(self, offset: int, limit: int) -> str:
        total = int(self.next_program_id) - 1
        out = []
        start = max(1, offset + 1)
        end = min(total + 1, start + limit)
        for i in range(start, end):
            k = str(i)
            if k in self.programs:
                out.append(self._program_json(k, self.programs[k]))
        return json.dumps(out)

    @gl.public.view
    def get_claim(self, claim_id: str) -> str:
        if claim_id not in self.claims:
            raise gl.vm.UserError("Claim not found")
        return json.dumps(self._claim_json(claim_id, self.claims[claim_id]))

    def _claim_json(self, cid: str, c: Claim) -> dict:
        return {
            "claim_id": cid,
            "program_id": c.program_id,
            "customer": c.customer,
            "month": c.month,
            "claimed_downtime_min": int(c.claimed_downtime_min),
            "evidence_url": c.evidence_url,
            "bond": str(c.bond),
            "state": c.state,
            "verdict": c.verdict,
            "tier": c.tier,
            "reason": c.reason,
            "confidence": int(c.confidence),
            "credit_amount": str(c.credit_amount),
            "challenge_deadline": int(c.challenge_deadline),
            "rebuttal_url": c.rebuttal_url,
            "created_at": int(c.created_at),
        }

    @gl.public.view
    def list_claims(self, program_id: str, offset: int, limit: int) -> str:
        total = int(self.next_claim_id) - 1
        out = []
        start = max(1, offset + 1)
        end = min(total + 1, start + limit)
        pf = program_id.strip()
        for i in range(start, end):
            k = str(i)
            if k in self.claims:
                c = self.claims[k]
                if not pf or pf == "ALL" or c.program_id == pf:
                    out.append(self._claim_json(k, c))
        return json.dumps(out)

    @gl.public.view
    def get_balance(self, addr: str) -> str:
        key = addr.strip().lower()
        bal = self.balances[key] if key in self.balances else bigint(0)
        return str(bal)

    @gl.public.view
    def get_stats(self) -> str:
        total_programs = int(self.next_program_id) - 1
        total_claims = int(self.next_claim_id) - 1
        tvl = bigint(0)
        for i in range(1, total_programs + 1):
            k = str(i)
            if k in self.programs:
                tvl = tvl + self.programs[k].reserve
        return json.dumps({
            "total_programs": total_programs,
            "total_claims": total_claims,
            "tvl_reserve": str(tvl),
            "fee_pool": str(self.fee_pool),
        })
