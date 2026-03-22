from datetime import datetime
from typing import Any, Dict, Optional

class TeeTime:
    def __init__(
            self,
            course_id: int,
            tee_time: datetime,
            price: float,
            holes: int,
            available: bool,
            source: str,
            raw: Dict[str, Any],
            spots_available: Optional[int] = None,
    ):
        self.course_id = course_id
        self.tee_time = tee_time
        self.price = price
        self.holes = holes
        self.available = available
        self.source = source
        self.raw = raw
        self.spots_available = spots_available

    def to_dict(self) -> dict:
        return {
            "course_id": self.course_id,
            "tee_time": self.tee_time.isoformat(),
            "price": self.price,
            "holes": self.holes,
            "available": self.available,
            "data": self.raw,
            "spots_available": self.spots_available,
        }