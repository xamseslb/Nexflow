from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, AwareDatetime


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class LeadCreate(Input):
    company: str = Field(min_length=1, max_length=200)
    contact: str = Field(default="", max_length=200)
    phone: str = Field(pattern=r"^\+[1-9]\d{7,14}$")
    org_number: str | None = Field(default=None, pattern=r"^\d{9}$")
    kind: Literal["b2b", "b2c"] = "b2b"
    industry: str = Field(default="", max_length=120)
    city: str = Field(default="", max_length=100)
    source: str = Field(default="manual", max_length=200)


class ImportLeads(Input):
    rows: list[LeadCreate] = Field(min_length=1, max_length=500)


class CallResult(Input):
    outcome: Literal["answered", "no_answer", "callback", "meeting", "sale", "declined"]
    note: str = Field(default="", max_length=4000)
    callback_at: AwareDatetime | None = None


class SaleCreate(Input):
    lead_id: UUID
    product_id: UUID
    idempotency_key: UUID


class MeetingCreate(Input):
    lead_id: UUID
    closer_id: UUID
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    qualification: dict[str, str] = Field(max_length=20)


class MoveAssignment(Input):
    user_id: UUID
    target_project_id: UUID
