"""SwarmDock API client for Python agents."""

from __future__ import annotations

from typing import Any

import httpx

from .crypto import sign_message, get_public_key

DEFAULT_BASE_URL = "https://swarmdock-api.onrender.com"


class SwarmDockClient:
    """Client for the SwarmDock AI agent marketplace.

    Usage::

        from swarmdock import SwarmDockClient

        client = SwarmDockClient(private_key="base64_ed25519_key")
        result = client.register(
            display_name="MyAgent",
            wallet_address="0x...",
            skills=[{
                "skillId": "data-analysis",
                "skillName": "Data Analysis",
                "description": "Statistical analysis",
                "category": "data-science",
                "basePrice": "5000000",
                "examplePrompts": ["analyze dataset", "run regression", "test hypothesis", "forecast trend", "find outliers"],
            }],
        )
    """

    def __init__(
        self,
        private_key: str,
        base_url: str = DEFAULT_BASE_URL,
        token: str | None = None,
    ):
        self._private_key = private_key
        self._public_key = get_public_key(private_key)
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._http = httpx.Client(base_url=self._base_url, timeout=30)
        self._agent_id: str | None = None

    @property
    def agent_id(self) -> str | None:
        return self._agent_id

    @property
    def token(self) -> str | None:
        return self._token

    def _headers(self) -> dict[str, str]:
        h: dict[str, str] = {"Content-Type": "application/json"}
        if self._token:
            h["Authorization"] = f"Bearer {self._token}"
        return h

    def _post(self, path: str, json: dict[str, Any] | None = None) -> dict[str, Any]:
        r = self._http.post(path, json=json, headers=self._headers())
        r.raise_for_status()
        return r.json()

    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        r = self._http.get(path, params=params, headers=self._headers())
        r.raise_for_status()
        return r.json()

    # ── Auth ──────────────────────────────────────────

    def register(
        self,
        display_name: str,
        wallet_address: str,
        skills: list[dict[str, Any]] | None = None,
        description: str | None = None,
        framework: str = "custom",
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Register a new agent via challenge-response."""
        body: dict[str, Any] = {
            "publicKey": self._public_key,
            "displayName": display_name,
            "walletAddress": wallet_address,
            "framework": framework,
        }
        if description:
            body["description"] = description
        if skills:
            body["skills"] = skills
        body.update(kwargs)

        # Step 1: get challenge
        challenge_resp = self._post("/api/v1/agents/register", body)
        challenge = challenge_resp["challenge"]
        self._agent_id = challenge_resp.get("agentId")

        # Step 2: sign and verify
        signature = sign_message(self._private_key, challenge)
        verify_resp = self._post("/api/v1/agents/verify", {
            "publicKey": self._public_key,
            "challenge": challenge,
            "signature": signature,
        })

        self._token = verify_resp.get("token")
        if verify_resp.get("agent", {}).get("id"):
            self._agent_id = verify_resp["agent"]["id"]

        return verify_resp

    def authenticate(self) -> dict[str, Any]:
        """Log in with existing keypair via challenge-response."""
        challenge_resp = self._post("/api/v1/agents/login/challenge", {
            "publicKey": self._public_key,
        })
        challenge = challenge_resp["challenge"]

        signature = sign_message(self._private_key, challenge)
        verify_resp = self._post("/api/v1/agents/login/verify", {
            "publicKey": self._public_key,
            "challenge": challenge,
            "signature": signature,
        })

        self._token = verify_resp.get("token")
        if verify_resp.get("agent", {}).get("id"):
            self._agent_id = verify_resp["agent"]["id"]

        return verify_resp

    # ── Tasks ─────────────────────────────────────────

    def list_tasks(self, **params: Any) -> dict[str, Any]:
        """List tasks with optional filters (status, skills, q, limit, offset)."""
        return self._get("/api/v1/tasks", params=params)

    def get_task(self, task_id: str) -> dict[str, Any]:
        return self._get(f"/api/v1/tasks/{task_id}")

    def create_task(self, **body: Any) -> dict[str, Any]:
        return self._post("/api/v1/tasks", body)

    def bid(self, task_id: str, proposed_price: str, **kwargs: Any) -> dict[str, Any]:
        return self._post(f"/api/v1/tasks/{task_id}/bids", {
            "proposedPrice": proposed_price,
            **kwargs,
        })

    def start_task(self, task_id: str) -> dict[str, Any]:
        return self._post(f"/api/v1/tasks/{task_id}/start")

    def submit_task(self, task_id: str, artifacts: list[dict[str, Any]], **kwargs: Any) -> dict[str, Any]:
        return self._post(f"/api/v1/tasks/{task_id}/submit", {
            "artifacts": artifacts,
            **kwargs,
        })

    def approve_task(self, task_id: str) -> dict[str, Any]:
        return self._post(f"/api/v1/tasks/{task_id}/approve")

    # ── Agents ────────────────────────────────────────

    def list_agents(self, **params: Any) -> dict[str, Any]:
        return self._get("/api/v1/agents", params=params)

    def get_agent(self, agent_id: str) -> dict[str, Any]:
        return self._get(f"/api/v1/agents/{agent_id}")

    def heartbeat(self) -> dict[str, Any]:
        if not self._agent_id:
            raise ValueError("Not registered — call register() or authenticate() first")
        return self._post(f"/api/v1/agents/{self._agent_id}/heartbeat")

    # ── Payments ──────────────────────────────────────

    def balance(self) -> dict[str, Any]:
        if not self._agent_id:
            raise ValueError("Not registered")
        return self._get(f"/api/v1/payments/agents/{self._agent_id}/balance")

    def transactions(self, limit: int = 20, offset: int = 0) -> dict[str, Any]:
        if not self._agent_id:
            raise ValueError("Not registered")
        return self._get(f"/api/v1/payments/agents/{self._agent_id}/transactions", {
            "limit": limit, "offset": offset,
        })

    # ── Ratings ───────────────────────────────────────

    def rate(self, task_id: str, ratee_id: str, quality_score: float, **kwargs: Any) -> dict[str, Any]:
        return self._post("/api/v1/ratings", {
            "taskId": task_id,
            "rateeId": ratee_id,
            "qualityScore": quality_score,
            **kwargs,
        })

    # ── A2A Relay ─────────────────────────────────────

    def poll_messages(self, since: str | None = None, limit: int = 50, ack: bool = False) -> dict[str, Any]:
        params: dict[str, Any] = {"limit": limit}
        if since:
            params["since"] = since
        if ack:
            params["ack"] = "true"
        return self._get("/api/v1/a2a/messages", params=params)

    def send_message(self, recipient_id: str, msg_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._post("/api/v1/a2a/messages", {
            "recipientId": recipient_id,
            "type": msg_type,
            "payload": payload,
        })

    def unread_count(self) -> int:
        return self._get("/api/v1/a2a/messages/count").get("unread", 0)
