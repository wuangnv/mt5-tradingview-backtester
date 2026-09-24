"""Chart-state APIs for the integrated workspace."""

from flask import jsonify, request

from chart_store import ChartConflict, ChartNotFound, ChartStoreError, ChartValidationError


def register_chart_routes(app, store):
    app.config["CHART_STORE"] = store

    def error(code, message, status):
        return jsonify({"success": False, "error": {"code": code, "message": message}}), status

    @app.errorhandler(ChartValidationError)
    def handle_chart_invalid(exc):
        return error(exc.code, str(exc), 422)

    @app.errorhandler(ChartNotFound)
    def handle_chart_not_found(exc):
        return error(exc.code, str(exc), 404)

    @app.errorhandler(ChartConflict)
    def handle_chart_conflict(exc):
        return error(exc.code, str(exc), 409)

    @app.errorhandler(ChartStoreError)
    def handle_chart_error(exc):
        return error(exc.code, str(exc), 500)

    def body():
        value = request.get_json(silent=True)
        if not isinstance(value, dict):
            raise ChartValidationError("request body must be a JSON object")
        return value

    @app.get("/api/chart/annotations")
    def list_annotations():
        return jsonify(
            {
                "success": True,
                "annotations": store.list_annotations(
                    request.args.get("instrument_id"), request.args.get("timeframe")
                ),
            }
        )

    @app.post("/api/chart/annotations")
    def create_annotation():
        return jsonify({"success": True, "annotation": store.create_annotation(body())}), 201

    @app.get("/api/chart/annotations/<annotation_id>/history")
    def annotation_history(annotation_id):
        return jsonify({"success": True, "history": store.history(annotation_id)})

    @app.patch("/api/chart/annotations/<annotation_id>")
    def update_annotation(annotation_id):
        value = body()
        annotation = store.update_annotation(
            annotation_id, value.get("annotation"), value.get("expected_revision")
        )
        return jsonify({"success": True, "annotation": annotation})

    @app.delete("/api/chart/annotations/<annotation_id>")
    def delete_annotation(annotation_id):
        value = body()
        annotation = store.delete_annotation(annotation_id, value.get("expected_revision"))
        return jsonify({"success": True, "annotation": annotation})

    @app.post("/api/chart/annotations/<annotation_id>/restore")
    def restore_annotation(annotation_id):
        value = body()
        annotation = store.restore_revision(
            annotation_id, value.get("revision"), value.get("expected_revision")
        )
        return jsonify({"success": True, "annotation": annotation})

    @app.get("/api/chart/layouts/<layout_key>")
    def get_layout(layout_key):
        return jsonify({"success": True, "layout": store.get_layout(layout_key)})

    @app.put("/api/chart/layouts/<layout_key>")
    def save_layout(layout_key):
        value = body()
        layout = store.save_layout(
            layout_key, value.get("payload"), value.get("expected_revision")
        )
        return jsonify({"success": True, "layout": layout})
