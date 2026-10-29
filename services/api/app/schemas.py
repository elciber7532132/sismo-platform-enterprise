from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field

class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    external_id: str
    source_id: str
    occurred_at: datetime
    latitude: float
    longitude: float
    magnitude: float
    magnitude_type: str | None
    depth_km: float
    place: str
    source_url: str | None
    received_at: datetime
    review_status: str

class SyncOut(BaseModel):
    status: str
    records_seen: int
    records_inserted: int
    message: str

class AlertRuleInput(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    min_magnitude: float = Field(ge=0, le=10)
    region: str = "world"
    enabled: bool = False
