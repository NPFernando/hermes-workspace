#!/usr/bin/env python3
"""Minimal auth server for Hermes dashboard login.
Runs on port 9120 (loopback only).
Handles password login and Google OAuth.
"""
import hashlib
import hmac
import http.server
import json
import os
import secrets
import sys
import time
import urllib.parse
import urllib.request

PASSWORD = "qEMu#E4%iYYmxTySQryve2virD%#rY"
SECRET = os.environ.get("HERMES_AUTH_SECRET", "hermes-dashboard-secret-2026")
COOKIE_NAME = "hermes_dash_session"
COOKIE_MAX_AGE = 30 * 24 * 3600  # 30 days

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = "https://hermes.fernandofamily.com/auth/google/callback"
GOOGLE_ALLOWED_EMAIL = "fernandonaveen2000@gmail.com"

# ---------------------------------------------------------------------------
# Server-side OAuth state store (avoids cookie round-trip issues)
# ---------------------------------------------------------------------------
_oauth_states: dict[str, float] = {}  # state -> expiry unix timestamp
STATE_TTL = 600  # 10 minutes


def _store_state(state: str) -> None:
    _oauth_states[state] = time.time() + STATE_TTL
    # prune expired entries
    now = time.time()
    expired = [s for s, exp in list(_oauth_states.items()) if exp < now]
    for s in expired:
        _oauth_states.pop(s, None)


def _consume_state(state: str) -> bool:
    exp = _oauth_states.get(state)
    if not exp or exp < time.time():
        return False
    _oauth_states.pop(state, None)
    return True


def _make_session_token() -> str:
    timestamp = str(int(time.time()))
    sig = hmac.new(SECRET.encode(), timestamp.encode(), hashlib.sha256).hexdigest()[:16]
    return f"{timestamp}.{sig}"


def _verify_token(token: str) -> bool:
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return False
        timestamp, sig = parts
        ts = int(timestamp)
        if time.time() - ts > COOKIE_MAX_AGE:
            return False
        expected = hmac.new(
            SECRET.encode(), timestamp.encode(), hashlib.sha256
        ).hexdigest()[:16]
        return hmac.compare_digest(sig, expected)
    except Exception:
        return False


def _exchange_code_for_email(code: str) -> str:
    token_data = urllib.parse.urlencode({
        "code": code,
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "grant_type": "authorization_code",
    }).encode()
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=token_data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        token_resp = json.loads(resp.read())

    access_token = token_resp.get("access_token")
    if not access_token:
        raise ValueError(f"No access_token: {token_resp}")

    req2 = urllib.request.Request(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    with urllib.request.urlopen(req2, timeout=10) as resp:
        user_info = json.loads(resp.read())

    email = user_info.get("email")
    if not email:
        raise ValueError("No email in userinfo response")
    return email


class AuthHandler(http.server.BaseHTTPRequestHandler):

    # ------------------------------------------------------------------
    # GET handlers (Google OAuth initiation + callback)
    # ------------------------------------------------------------------

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = dict(urllib.parse.parse_qsl(parsed.query))

        if path == "/auth/google":
            if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
                self._redirect("/login?error=oauth_disabled")
                return

            state = secrets.token_hex(16)
            _store_state(state)

            auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
                "response_type": "code",
                "client_id": GOOGLE_CLIENT_ID,
                "redirect_uri": GOOGLE_REDIRECT_URI,
                "scope": "openid email",
                "state": state,
                "access_type": "online",
                "prompt": "select_account",
            })
            self._redirect(auth_url)

        elif path == "/auth/google/callback":
            code = params.get("code", "")
            state = params.get("state", "")

            if not code or not state:
                self._redirect("/login?error=oauth_invalid")
                return

            if not _consume_state(state):
                self._redirect("/login?error=oauth_state")
                return

            try:
                email = _exchange_code_for_email(code)
            except Exception as exc:
                print(f"[google/callback] token exchange error: {exc}", flush=True)
                self._redirect("/login?error=oauth_failed")
                return

            if email.lower() != GOOGLE_ALLOWED_EMAIL.lower():
                self._redirect("/login?error=unauthorized_email")
                return

            token = _make_session_token()
            self.send_response(302)
            self.send_header("Location", "/")
            self.send_header(
                "Set-Cookie",
                f"{COOKIE_NAME}={token}; Path=/; Max-Age={COOKIE_MAX_AGE}; "
                f"HttpOnly; Secure; SameSite=Lax",
            )
            self.end_headers()

        else:
            self.send_response(404)
            self.end_headers()

    # ------------------------------------------------------------------
    # POST handlers (password login / logout / verify)
    # ------------------------------------------------------------------

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        if self.path == "/auth/login":
            try:
                data = json.loads(body)
                password = data.get("password", "")
            except Exception:
                password = ""

            if password == PASSWORD:
                token = _make_session_token()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header(
                    "Set-Cookie",
                    f"{COOKIE_NAME}={token}; Path=/; Max-Age={COOKIE_MAX_AGE}; "
                    f"HttpOnly; Secure; SameSite=Strict",
                )
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True}).encode())
            else:
                self.send_response(401)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": "Invalid password"}).encode())

        elif self.path == "/auth/logout":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header(
                "Set-Cookie",
                f"{COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict",
            )
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True}).encode())

        elif self.path == "/auth/verify":
            cookie_header = self.headers.get("Cookie", "")
            token = None
            for part in cookie_header.split(";"):
                part = part.strip()
                if part.startswith(f"{COOKIE_NAME}="):
                    token = part.split("=", 1)[1]
                    break

            if token and _verify_token(token):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True}).encode())
            else:
                self.send_response(401)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False}).encode())

        else:
            self.send_response(404)
            self.end_headers()

    def _redirect(self, location: str) -> None:
        self.send_response(302)
        self.send_header("Location", location)
        self.end_headers()

    def log_message(self, format, *args):
        pass  # suppress access logs


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9120
    server = http.server.HTTPServer(("127.0.0.1", port), AuthHandler)
    print(f"Auth server running on 127.0.0.1:{port}", flush=True)
    server.serve_forever()
