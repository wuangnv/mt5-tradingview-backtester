"""Local-only AI advisory routes. AI has no business-state or broker write authority."""

from urllib.parse import urlsplit

from flask import jsonify, request

from ai_service import AIFeatureDisabled, AIInvalidRequest, AIServiceError


def register_ai_routes(app, service):
    app.config["AI_SERVICE"] = service

    def error(code, message, status):
        return jsonify({"success": False, "error": {"code": code, "message": message}}), status

    @app.before_request
    def protect_ai_routes():
        if not request.path.startswith("/api/ai/"):
            return None
        if request.remote_addr not in {"127.0.0.1", "::1"}:
            return error("LOCAL_ONLY", "AI API is local-only", 403)
        host = (urlsplit(f"//{request.host}").hostname or "").lower()
        if host not in {"127.0.0.1", "localhost", "::1"}:
            return error("LOCAL_ONLY", "AI API requires a loopback host", 403)
        return None

    @app.errorhandler(AIInvalidRequest)
    def handle_ai_invalid(exc):
        return error(exc.code, str(exc), 422)

    @app.errorhandler(AIFeatureDisabled)
    def handle_ai_disabled(exc):
        return error(exc.code, str(exc), 409)

    @app.errorhandler(AIServiceError)
    def handle_ai_error(exc):
        return error(exc.code, str(exc), 503)

    @app.get("/api/ai/status")
    def ai_status():
        return jsonify({"success": True, "ai": service.status()})

    @app.post("/api/ai/request")
    def ai_request():
        value = request.get_json(silent=True)
        if not isinstance(value, dict):
            raise AIInvalidRequest("request body must be a JSON object")
        return jsonify({"success": True, "ai": service.request(value)})
