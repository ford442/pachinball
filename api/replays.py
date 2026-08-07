#!/usr/bin/env python3
"""
Backend API for Async Challenges & Replay Payload Storage.

Endpoints:
  POST /api/replays      — Upload a compressed/json ReplayPayload (max 500 KB)
  GET  /api/replays/:id  — Retrieve ReplayPayload by ID
  POST /api/challenges   — Create a shareable challenge
  GET  /api/challenges/:id — Retrieve challenge metadata
"""

import json
import os
import uuid
from datetime import datetime
from typing import Dict, Any, Optional

STORAGE_DIR = os.environ.get('REPLAY_STORAGE_DIR', './replay_data')
MAX_PAYLOAD_SIZE_BYTES = 512 * 1024  # 512 KB limit

os.makedirs(STORAGE_DIR, exist_ok=True)
os.makedirs(os.path.join(STORAGE_DIR, 'replays'), exist_ok=True)
os.makedirs(os.path.join(STORAGE_DIR, 'challenges'), exist_ok=True)


def get_replay_path(replay_id: str) -> str:
    # Basic sanitize to prevent path traversal
    safe_id = "".join(c for c in replay_id if c.isalnum() or c in ("-", "_"))
    return os.path.join(STORAGE_DIR, 'replays', f"{safe_id}.json")


def get_challenge_path(challenge_id: str) -> str:
    safe_id = "".join(c for c in challenge_id if c.isalnum() or c in ("-", "_"))
    return os.path.join(STORAGE_DIR, 'challenges', f"{safe_id}.json")


def save_replay(payload: Dict[str, Any]) -> Dict[str, Any]:
    replay_id = payload.get("replay_id") or f"r_{uuid.uuid4().hex[:12]}"
    payload["replay_id"] = replay_id
    payload["uploaded_at"] = datetime.now().isoformat()

    raw_json = json.dumps(payload)
    if len(raw_json.encode('utf-8')) > MAX_PAYLOAD_SIZE_BYTES:
        raise ValueError(f"Payload size ({len(raw_json)} bytes) exceeds limit of {MAX_PAYLOAD_SIZE_BYTES} bytes")

    path = get_replay_path(replay_id)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(raw_json)

    return {
        "success": True,
        "replay_id": replay_id,
        "bytes": len(raw_json),
    }


def load_replay(replay_id: str) -> Optional[Dict[str, Any]]:
    path = get_replay_path(replay_id)
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return None


def save_challenge(challenge_data: Dict[str, Any]) -> Dict[str, Any]:
    challenge_id = challenge_data.get("id") or f"c_{uuid.uuid4().hex[:10]}"
    challenge_data["id"] = challenge_id
    challenge_data["created_at"] = datetime.now().isoformat()

    path = get_challenge_path(challenge_id)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(challenge_data, f, indent=2)

    return {
        "success": True,
        "challenge_id": challenge_id,
    }


def load_challenge(challenge_id: str) -> Optional[Dict[str, Any]]:
    path = get_challenge_path(challenge_id)
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return None


# FastAPI Implementation
try:
    from fastapi import FastAPI, HTTPException, Request
    from pydantic import BaseModel

    app = FastAPI()

    @app.post("/api/replays")
    async def post_replay(request: Request):
        body = await request.json()
        try:
            res = save_replay(body)
            return res
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.get("/api/replays/{replay_id}")
    async def get_replay(replay_id: str):
        replay = load_replay(replay_id)
        if not replay:
            raise HTTPException(status_code=404, detail="Replay not found")
        return replay

    @app.post("/api/challenges")
    async def post_challenge(request: Request):
        body = await request.json()
        return save_challenge(body)

    @app.get("/api/challenges/{challenge_id}")
    async def get_challenge(challenge_id: str):
        challenge = load_challenge(challenge_id)
        if not challenge:
            raise HTTPException(status_code=404, detail="Challenge not found")
        return challenge

except ImportError:
    pass


# Flask Implementation
try:
    from flask import Flask, request, jsonify

    flask_app = Flask(__name__)

    @flask_app.route("/api/replays", methods=["POST"])
    def flask_post_replay():
        data = request.get_json()
        try:
            res = save_replay(data)
            return jsonify(res)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @flask_app.route("/api/replays/<replay_id>", methods=["GET"])
    def flask_get_replay(replay_id):
        replay = load_replay(replay_id)
        if not replay:
            return jsonify({"error": "Replay not found"}), 404
        return jsonify(replay)

    @flask_app.route("/api/challenges", methods=["POST"])
    def flask_post_challenge():
        data = request.get_json()
        res = save_challenge(data)
        return jsonify(res)

    @flask_app.route("/api/challenges/<challenge_id>", methods=["GET"])
    def flask_get_challenge(challenge_id):
        challenge = load_challenge(challenge_id)
        if not challenge:
            return jsonify({"error": "Challenge not found"}), 404
        return jsonify(challenge)

except ImportError:
    pass
