#!/usr/bin/env python3
"""
Backend API stub for Adventure Mode progress storage.
This is a simple FastAPI/Flask-compatible endpoint that stores progress
in GCS (Google Cloud Storage) or local filesystem.
"""

import json
import os
from datetime import datetime
from typing import Dict, Any

# Simple file-based storage for development
# In production, this would use GCS
STORAGE_DIR = os.environ.get('ADVENTURE_STORAGE_DIR', './adventure_data')
os.makedirs(STORAGE_DIR, exist_ok=True)


def get_progress_path(user_id: str = "default") -> str:
    """Get the storage path for a user's progress."""
    return os.path.join(STORAGE_DIR, f"{user_id}_progress.json")


def load_progress(user_id: str = "default") -> Dict[str, Any]:
    """Load progress from storage."""
    path = get_progress_path(user_id)
    if os.path.exists(path):
        with open(path, 'r') as f:
            return json.load(f)
    return {
        "currentLevel": "level-1-neon",
        "currentMap": "neon-helix",
        "completedLevels": [],
        "unlockedMaps": ["neon-helix"],
        "totalScore": 0,
        "bestScores": {},
        "lastPlayed": datetime.now().isoformat(),
    }


def save_progress(user_id: str, progress: Dict[str, Any]) -> None:
    """Save progress to storage."""
    path = get_progress_path(user_id)
    progress["lastPlayed"] = datetime.now().isoformat()
    with open(path, 'w') as f:
        json.dump(progress, f, indent=2)


# FastAPI version (if using FastAPI)
try:
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel

    app = FastAPI()

    class ProgressData(BaseModel):
        currentLevel: str
        currentMap: str
        completedLevels: list
        unlockedMaps: list
        totalScore: int
        bestScores: Dict[str, int]
        lastPlayed: str

    @app.get("/api/adventure/progress")
    async def get_adventure_progress(user_id: str = "default"):
        """Get the current adventure progress for a user."""
        return load_progress(user_id)

    @app.post("/api/adventure/progress")
    async def post_adventure_progress(data: ProgressData, user_id: str = "default"):
        """Save adventure progress for a user."""
        save_progress(user_id, data.dict())
        return {"status": "saved", "lastPlayed": data.lastPlayed}

    @app.get("/api/adventure/levels")
    async def get_adventure_levels():
        """Get all adventure level definitions."""
        from adventure_levels import ADVENTURE_LEVELS
        return {"levels": ADVENTURE_LEVELS}

except ImportError:
    pass  # FastAPI not installed


# Flask version (if using Flask)
try:
    from flask import Flask, request, jsonify

    flask_app = Flask(__name__)

    @flask_app.route("/api/adventure/progress", methods=["GET"])
    def get_progress():
        user_id = request.args.get("user_id", "default")
        return jsonify(load_progress(user_id))

    @flask_app.route("/api/adventure/progress", methods=["POST"])
    def post_progress():
        user_id = request.args.get("user_id", "default")
        data = request.get_json()
        save_progress(user_id, data)
        return jsonify({"status": "saved", "lastPlayed": data.get("lastPlayed")})

    @flask_app.route("/api/adventure/levels", methods=["GET"])
    def get_levels():
        from adventure_levels import ADVENTURE_LEVELS
        return jsonify({"levels": ADVENTURE_LEVELS})

except ImportError:
    pass  # Flask not installed


if __name__ == "__main__":
    # Simple CLI for testing
    import sys
    if len(sys.argv) > 1:
        if sys.argv[1] == "get":
            print(json.dumps(load_progress(), indent=2))
        elif sys.argv[1] == "reset":
            save_progress("default", {
                "currentLevel": "level-1-neon",
                "currentMap": "neon-helix",
                "completedLevels": [],
                "unlockedMaps": ["neon-helix"],
                "totalScore": 0,
                "bestScores": {},
                "lastPlayed": datetime.now().isoformat(),
            })
            print("Progress reset")
