#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#

from __future__ import annotations

import threading
from collections import Counter
from dataclasses import dataclass, field


@dataclass
class BusinessGatewayTelemetry:
    """Bounded process-local metrics intended for per-replica scraping."""

    _lock: threading.Lock = field(default_factory=threading.Lock)
    _requests: Counter[tuple[str, str, int]] = field(default_factory=Counter)
    _failures: Counter[tuple[str, str]] = field(default_factory=Counter)
    _duration_ms: Counter[str] = field(default_factory=Counter)
    _readiness: int = 0

    def observe_request(self, operation: str, outcome: str, status: int, duration_ms: int) -> None:
        with self._lock:
            self._requests[(operation, outcome, status)] += 1
            self._duration_ms[operation] += max(0, duration_ms)

    def observe_failure(self, component: str, reason: str) -> None:
        with self._lock:
            self._failures[(component, reason)] += 1

    def set_readiness(self, ready: bool) -> None:
        with self._lock:
            self._readiness = int(ready)

    def render_prometheus(self, uncertain_idempotency: int, stale_executing_idempotency: int = 0) -> str:
        with self._lock:
            requests = tuple(sorted(self._requests.items()))
            failures = tuple(sorted(self._failures.items()))
            durations = tuple(sorted(self._duration_ms.items()))
            readiness = self._readiness

        lines = [
            "# HELP nomix_ragflow_business_gateway_ready Whether this replica is ready to serve business traffic.",
            "# TYPE nomix_ragflow_business_gateway_ready gauge",
            f"nomix_ragflow_business_gateway_ready {readiness}",
            "# HELP nomix_ragflow_business_gateway_requests_total Completed Business Gateway requests.",
            "# TYPE nomix_ragflow_business_gateway_requests_total counter",
        ]
        for (operation, outcome, status), value in requests:
            lines.append(f'nomix_ragflow_business_gateway_requests_total{{operation="{_label(operation)}",outcome="{_label(outcome)}",status="{status}"}} {value}')
        lines.extend(
            [
                "# HELP nomix_ragflow_business_gateway_request_duration_milliseconds_total Cumulative request time by operation.",
                "# TYPE nomix_ragflow_business_gateway_request_duration_milliseconds_total counter",
            ]
        )
        for operation, value in durations:
            lines.append(f'nomix_ragflow_business_gateway_request_duration_milliseconds_total{{operation="{_label(operation)}"}} {value}')
        lines.extend(
            [
                "# HELP nomix_ragflow_business_gateway_failures_total Dependency and durability failures.",
                "# TYPE nomix_ragflow_business_gateway_failures_total counter",
            ]
        )
        for (component, reason), value in failures:
            lines.append(f'nomix_ragflow_business_gateway_failures_total{{component="{_label(component)}",reason="{_label(reason)}"}} {value}')
        lines.extend(
            [
                "# HELP nomix_ragflow_business_gateway_uncertain_idempotency_records Commands requiring operator reconciliation.",
                "# TYPE nomix_ragflow_business_gateway_uncertain_idempotency_records gauge",
                f"nomix_ragflow_business_gateway_uncertain_idempotency_records {max(-1, uncertain_idempotency)}",
                "# HELP nomix_ragflow_business_gateway_stale_executing_idempotency_records Commands beyond the safe retry boundary for more than 30 minutes.",
                "# TYPE nomix_ragflow_business_gateway_stale_executing_idempotency_records gauge",
                f"nomix_ragflow_business_gateway_stale_executing_idempotency_records {max(-1, stale_executing_idempotency)}",
            ]
        )
        return "\n".join(lines) + "\n"


def _label(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


__all__ = ["BusinessGatewayTelemetry"]
