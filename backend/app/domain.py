from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID


@dataclass(frozen=True)
class Eligibility:
    allowed: bool
    reason: str


def can_call(*, active: bool, blocked: bool, kind: str, reserved_by: UUID | None,
             reserved_until: datetime | None, user_id: UUID, now: datetime,
             checked_at: datetime | None = None, registry_reserved: bool | None = None,
             consent_valid: bool = False) -> Eligibility:
    if not active:
        return Eligibility(False, "Prosjektet er pauset")
    if blocked:
        return Eligibility(False, "Kontakten har bedt om ikke å bli ringt")
    if reserved_by and reserved_by != user_id and reserved_until and reserved_until > now:
        return Eligibility(False, "Leadet er reservert av en annen selger")
    if kind == "b2c" and not consent_valid:
        if checked_at is None or not (now - timedelta(days=30) < checked_at <= now):
            return Eligibility(False, "Mangler gyldig registersjekk eller samtykke")
        if registry_reserved is not False:
            return Eligibility(False, "Reservert mot telefonsalg – mangler gyldig samtykke")
    if kind not in ("b2b", "b2c"):
        return Eligibility(False, "Ukjent kontakttype")
    return Eligibility(True, "Kan ringes")


def allocate(amount_ore: int, hub_bps: int, seller_bps: int) -> dict[str, int]:
    if amount_ore <= 0 or min(hub_bps, seller_bps) < 0 or hub_bps + seller_bps > 10_000:
        raise ValueError("Ugyldig beløp eller fordelingsregel")
    # Integer-only floor rounding. The partner receives the residual, exactly.
    hub = amount_ore * hub_bps // 10_000
    seller = amount_ore * seller_bps // 10_000
    return {"hub": hub, "seller": seller, "partner": amount_ore - hub - seller}


def can_approve(kind: str, confirmed_at: datetime | None) -> bool:
    return kind == "b2b" or (kind == "b2c" and confirmed_at is not None)


def payout_eligible(status: str, kind: str, withdrawal_ends_at: datetime | None, now: datetime) -> bool:
    return status == "approved" and (kind == "b2b" or (
        kind == "b2c" and withdrawal_ends_at is not None and withdrawal_ends_at <= now))
