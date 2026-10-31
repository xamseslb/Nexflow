from datetime import datetime, timedelta, timezone
from uuid import uuid4
import pytest
from app.domain import allocate, can_call, can_approve, payout_eligible

NOW = datetime(2026, 10, 31, 12, tzinfo=timezone.utc)
USER = uuid4()


def check(**overrides):
    values = dict(active=True, blocked=False, kind="b2b", reserved_by=None,
                  reserved_until=None, user_id=USER, now=NOW)
    return can_call(**(values | overrides))


def test_b2b_without_private_enrichment():
    assert check().allowed


@pytest.mark.parametrize("changes", [
    {"active": False}, {"blocked": True}, {"kind": "unknown"},
    {"reserved_by": uuid4(), "reserved_until": NOW + timedelta(seconds=1)},
    {"kind": "b2c"},
    {"kind": "b2c", "checked_at": NOW - timedelta(days=30), "registry_reserved": False},
    {"kind": "b2c", "checked_at": NOW + timedelta(seconds=1), "registry_reserved": False},
    {"kind": "b2c", "checked_at": NOW, "registry_reserved": True},
    {"kind": "b2c", "checked_at": NOW, "registry_reserved": None},
    {"kind": "b2c", "blocked": True, "consent_valid": True},
])
def test_calling_fails_closed(changes):
    assert not check(**changes).allowed


def test_recent_unreserved_b2c():
    assert check(kind="b2c", checked_at=NOW - timedelta(days=29), registry_reserved=False).allowed


def test_direct_valid_consent():
    assert check(kind="b2c", checked_at=NOW, registry_reserved=True, consent_valid=True).allowed


def test_expired_reservation_can_be_claimed():
    assert check(reserved_by=uuid4(), reserved_until=NOW).allowed


def test_every_ore_is_allocated_even_at_rounding_boundaries():
    for amount in [1, 2, 7, 99, 100, 101, 999, 2490000, 10**12 + 7]:
        for hub, seller in [(0, 0), (3333, 3333), (2000, 1000), (9999, 1), (0, 10000)]:
            result = allocate(amount, hub, seller)
            assert sum(result.values()) == amount
            assert all(isinstance(x, int) and x >= 0 for x in result.values())


@pytest.mark.parametrize("values", [(0, 1, 1), (-1, 100, 100), (100, -1, 100), (100, 5001, 5000)])
def test_invalid_rules_are_rejected(values):
    with pytest.raises(ValueError):
        allocate(*values)


def test_b2c_approval_and_withdrawal_are_separate_gates():
    assert not can_approve("b2c", None)
    assert can_approve("b2c", NOW)
    assert not payout_eligible("approved", "b2c", None, NOW)
    assert not payout_eligible("approved", "b2c", NOW + timedelta(seconds=1), NOW)
    assert payout_eligible("approved", "b2c", NOW, NOW)
    assert not payout_eligible("registered", "b2b", None, NOW)
