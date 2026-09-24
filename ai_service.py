"""Application-level advisory AI service with bounded, stale-aware requests."""

import hashlib
import json

from ai_provider import AIProviderError, AIProviderUnavailable


ALLOWED_STATUSES = {"ok", "uncertain", "unavailable", "stale", "invalid_context"}
ALLOWED_JOBS = {"playbook_search", "research_rule_draft", "journal_review", "chart_overlay"}


class AIServiceError(RuntimeError):
    code = "AI_SERVICE_ERROR"


class AIInvalidRequest(AIServiceError):
    code = "AI_INVALID_REQUEST"


class AIFeatureDisabled(AIServiceError):
    code = "AI_FEATURE_DISABLED"


def canonical_hash(job, context_version, state):
    payload = {
        "job": job,
        "context_version": context_version,
        "state": state,
    }
    try:
        encoded = json.dumps(
            payload,
            ensure_ascii=True,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise AIInvalidRequest("AI state must be JSON serializable") from exc
    return hashlib.sha256(encoded).hexdigest(), len(encoded)


class AIService:
    def __init__(
        self,
        provider,
        *,
        enabled_jobs=None,
        max_payload_bytes=16_384,
        max_input_items=64,
    ):
        self.provider = provider
        self.enabled_jobs = set(enabled_jobs or ())
        self.max_payload_bytes = int(max_payload_bytes)
        self.max_input_items = int(max_input_items)
        if self.max_payload_bytes < 256:
            raise ValueError("max_payload_bytes is too small")
        if self.max_input_items < 1:
            raise ValueError("max_input_items must be positive")

    def status(self):
        health = self.provider.health()
        capabilities = dict(getattr(self.provider, "capabilities", {}))
        capabilities["broker_actions"] = False
        return {
            "provider": getattr(self.provider, "provider_id", "unknown"),
            "model": getattr(self.provider, "model_id", None),
            "provider_health": health,
            "enabled_jobs": sorted(self.enabled_jobs),
            "capabilities": capabilities,
            "limits": {
                "max_payload_bytes": self.max_payload_bytes,
                "max_input_items": self.max_input_items,
            },
            "execution_capability": False,
        }

    def _validate_state(self, state):
        if not isinstance(state, dict):
            raise AIInvalidRequest("state must be an object")
        for key, value in state.items():
            if isinstance(value, list) and len(value) > self.max_input_items:
                raise AIInvalidRequest(f"state.{key} exceeds max_input_items")
        forbidden = {"api_key", "password", "secret", "broker_credentials", "holdout_bars"}
        present = sorted(forbidden.intersection(str(key).lower() for key in state))
        if present:
            raise AIInvalidRequest("state contains forbidden sensitive or holdout fields")
        return json.loads(json.dumps(state, ensure_ascii=True, allow_nan=False))

    def request(self, envelope):
        if not isinstance(envelope, dict):
            raise AIInvalidRequest("request must be an object")
        job = str(envelope.get("job") or "").strip()
        if job not in ALLOWED_JOBS:
            raise AIInvalidRequest("job is unsupported")
        context_version = str(envelope.get("context_version") or "").strip()
        if not context_version:
            raise AIInvalidRequest("context_version is required")
        state = self._validate_state(envelope.get("state"))
        actual_hash, payload_bytes = canonical_hash(job, context_version, state)
        if payload_bytes > self.max_payload_bytes:
            raise AIInvalidRequest("AI request exceeds max_payload_bytes")
        supplied_hash = str(envelope.get("context_hash") or "").strip().lower()
        if supplied_hash and supplied_hash != actual_hash:
            return self._response("invalid_context", actual_hash, {}, None, 0.0)
        if job not in self.enabled_jobs:
            return self._response("unavailable", actual_hash, {}, None, 0.0)
        if not getattr(self.provider, "capabilities", {}).get(job, False):
            return self._response("unavailable", actual_hash, {}, None, 0.0)
        try:
            provider_result = self.provider.invoke(job, state)
        except AIProviderUnavailable:
            return self._response("unavailable", actual_hash, {}, None, 0.0)
        except AIProviderError as exc:
            raise AIServiceError(str(exc)) from exc
        status = str(provider_result.get("status") or "").strip().lower()
        if status not in ALLOWED_STATUSES:
            raise AIServiceError("provider returned an unsupported status")
        result = provider_result.get("result")
        if not isinstance(result, dict):
            raise AIServiceError("provider result must be an object")
        usage = provider_result.get("usage")
        if usage is not None and not isinstance(usage, dict):
            raise AIServiceError("provider usage must be an object or null")
        latency_ms = provider_result.get("latency_ms")
        return self._response(status, actual_hash, result, usage, latency_ms)

    def _response(self, status, context_hash, result, usage, latency_ms):
        return {
            "status": status,
            "provider": getattr(self.provider, "provider_id", "unknown"),
            "model": getattr(self.provider, "model_id", None),
            "context_hash": context_hash,
            "result": result,
            "usage": usage,
            "latency_ms": latency_ms,
        }
