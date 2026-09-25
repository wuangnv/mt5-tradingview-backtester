"""Prop session workspace surface.

This first slice exposes the already implemented PS-00 contract without
creating a second evaluator or connecting to a broker.
"""

from flask import render_template


def register_prop_routes(app):
    @app.get("/prop-session")
    def prop_session_page():
        return render_template("prop_session.html")
