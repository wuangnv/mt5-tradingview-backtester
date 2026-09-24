"""Provider-neutral AI boundary. This module must stay free of broker/execution imports."""

import time


class AIProviderError(RuntimeError):
    code = "AI_PROVIDER_ERROR"


class AIProviderUnavailable(AIProviderError):
    code = "AI_PROVIDER_UNAVAILABLE"


class OfflineProvider:
    """Deterministic provider used when AI is disabled and by normal offline tests."""

    provider_id = "offline"
    model_id = None
    capabilities = {
        "playbook_search": False,
        "research_rule_draft": False,
        "journal_review": False,
        "chart_overlay": False,
        "broker_actions": False,
    }

    def health(self):
        return {"available": False, "reason": "AI provider is disabled"}

    def invoke(self, job, state):
        raise AIProviderUnavailable("AI provider is disabled")


class FakeProvider:
    """Injected deterministic provider for product contract and evaluation tests only."""

    provider_id = "fake"
    model_id = "fake-v1"
    capabilities = {
        "playbook_search": True,
        "research_rule_draft": True,
        "journal_review": True,
        "chart_overlay": True,
        "broker_actions": False,
    }

    def __init__(self, responses=None, *, available=True):
        self.responses = dict(responses or {})
        self.available = bool(available)
        self.calls = []

    def health(self):
        return {"available": self.available, "reason": None if self.available else "fake unavailable"}

    def invoke(self, job, state):
        if not self.available:
            raise AIProviderUnavailable("fake provider is unavailable")
        started = time.perf_counter()
        self.calls.append({"job": job, "state": state})
        response = self.responses.get(job)
        if callable(response):
            response = response(state)
        if response is None:
            response = {"status": "uncertain", "result": {}}
        if not isinstance(response, dict):
            raise AIProviderError("fake provider response must be an object")
        return {
            "status": response.get("status", "ok"),
            "result": response.get("result", {}),
            "usage": response.get("usage", {"input_tokens": None, "output_tokens": None}),
            "latency_ms": round((time.perf_counter() - started) * 1000.0, 3),
        }
