#!/usr/bin/env python3
"""
Deploy the production build to the Contabo storage manager.

Usage:
  1. Build:  npm run build
  2. Configure credentials (see .env.deploy.example), then:
     python deploy.py
     python deploy.py --list-only   # dry-run: print transfer plan only

The deploy service zips dist/ locally and uploads a single bundle over HTTPS.
SFTP credentials stay on the VPS; only DEPLOY_TOKEN is required locally.

Requirements:
  pip install requests
"""

from __future__ import annotations

import argparse
import io
import os
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import requests

DEFAULT_BASE_URL = "https://storage.noahcohn.com"
DEFAULT_PROJECT_NAME = "pachinball"
DEFAULT_BUILD_DIR = "dist"
ENV_FILE_NAME = ".env.deploy"
SKIP_DIR_PARTS = frozenset({".git", "node_modules", "__pycache__"})


@dataclass(frozen=True)
class DeployConfig:
    token: str
    base_url: str
    project_name: str
    build_dir: str
    target_folder: str


class DeployConfigError(Exception):
    """Raised when required deploy configuration is missing or invalid."""


def load_env_file(path: Path) -> None:
    """Load KEY=VALUE pairs from a dotenv-style file into os.environ."""
    if not path.is_file():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue

        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if not key:
            continue

        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]

        os.environ.setdefault(key, value)


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise DeployConfigError(
            f"Missing required environment variable: {name}\n"
            f"Copy .env.deploy.example to {ENV_FILE_NAME} and set {name}, "
            f"or export it in your shell before running deploy.py."
        )
    return value


def load_deploy_config(env_file: Path | None = None) -> DeployConfig:
    load_env_file(env_file or Path(ENV_FILE_NAME))

    token = require_env("DEPLOY_TOKEN")
    base_url = os.environ.get("DEPLOY_BASE_URL", DEFAULT_BASE_URL).strip() or DEFAULT_BASE_URL
    project_name = os.environ.get("DEPLOY_PROJECT_NAME", DEFAULT_PROJECT_NAME).strip() or DEFAULT_PROJECT_NAME
    build_dir = os.environ.get("DEPLOY_BUILD_DIR", DEFAULT_BUILD_DIR).strip() or DEFAULT_BUILD_DIR
    target_folder = os.environ.get("DEPLOY_TARGET_FOLDER", "").strip() or project_name

    return DeployConfig(
        token=token,
        base_url=base_url.rstrip("/"),
        project_name=project_name,
        build_dir=build_dir,
        target_folder=target_folder,
    )


def iter_build_files(build_path: Path) -> Iterable[Path]:
    for file in sorted(build_path.rglob("*")):
        if not file.is_file():
            continue
        rel = file.relative_to(build_path)
        if any(part in SKIP_DIR_PARTS for part in rel.parts):
            continue
        yield rel


def build_zip(build_path: Path, *, verbose: bool = True) -> bytes:
    """Zip the contents of build_path into an in-memory archive."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for rel in iter_build_files(build_path):
            zf.write(build_path / rel, str(rel))
            if verbose:
                print(f"  + {rel}")
    return buf.getvalue()


def print_transfer_plan(config: DeployConfig, build_path: Path) -> None:
    files = list(iter_build_files(build_path))
    total_bytes = sum((build_path / rel).stat().st_size for rel in files)
    bundle_url = f"{config.base_url}/api/deploy/{config.project_name}/bundle"

    print("Deploy dry-run (--list-only)")
    print("=======================")
    print(f"Project:        {config.project_name}")
    print(f"Build dir:      {build_path.resolve()}")
    print(f"Remote service: {config.base_url}")
    print(f"Bundle URL:     {bundle_url}")
    print(f"Target folder:  {config.target_folder}")
    print(f"Auth:           DEPLOY_TOKEN is set ({len(config.token)} chars)")
    print(f"Files:          {len(files)}")
    print(f"Uncompressed:   {total_bytes / 1024:.1f} KB")
    print()
    print("Files that would be uploaded:")
    for rel in files:
        size_kb = (build_path / rel).stat().st_size / 1024
        print(f"  {rel} ({size_kb:.1f} KB)")
    print()
    print("No files were uploaded.")


def deploy_bundle(config: DeployConfig, build_path: Path) -> bool:
    """Zip the build and upload it as a single bundle."""
    url = f"{config.base_url}/api/deploy/{config.project_name}/bundle"
    headers = {"X-Deploy-Token": config.token}

    print("Building zip archive...")
    zip_bytes = build_zip(build_path)
    print(f"Archive size: {len(zip_bytes) / 1024:.1f} KB\n")

    print("Uploading bundle...")
    try:
        response = requests.post(
            url,
            files={"bundle": ("build.zip", zip_bytes, "application/zip")},
            data={"target_folder": config.target_folder},
            headers=headers,
            timeout=300,
        )
    except Exception as exc:
        print(f"  ✗ Upload exception: {exc}")
        return False

    if response.status_code == 200:
        data = response.json()
        print(f"  ✓ {data.get('uploaded', 0)} files uploaded")
        if data.get("failed"):
            print("  Failures:")
            for failure in data["failed"]:
                print(f"    ✗ {failure['path']}: {failure['error']}")
        return not data.get("failed")

    print(f"  ✗ {response.status_code}: {response.text[:400]}")
    return False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Deploy the production build bundle.")
    parser.add_argument(
        "--list-only",
        action="store_true",
        help="Print the transfer plan without uploading.",
    )
    parser.add_argument(
        "--env-file",
        default=ENV_FILE_NAME,
        help=f"Path to dotenv-style deploy config (default: {ENV_FILE_NAME}).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    try:
        config = load_deploy_config(Path(args.env_file))
    except DeployConfigError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"\n=== Deploying '{config.project_name}' via {config.base_url} ===\n")

    build_path = Path(config.build_dir)
    if not build_path.exists() or not build_path.is_dir():
        print(f"ERROR: Build directory '{config.build_dir}/' does not exist.")
        print("Please run your build command first (e.g. `npm run build`).")
        sys.exit(1)

    if args.list_only:
        print_transfer_plan(config, build_path)
        sys.exit(0)

    try:
        health = requests.get(f"{config.base_url}/api/deploy/health", timeout=10)
        if health.status_code == 200:
            print(f"Deploy service: {health.json().get('status', 'unknown')}")
    except Exception:
        print(f"Warning: Could not contact {config.base_url} (continuing anyway).")

    print()
    success = deploy_bundle(config, build_path)

    print(f"\n=== {'Deployment complete' if success else 'Deployment finished with errors'} ===")
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
