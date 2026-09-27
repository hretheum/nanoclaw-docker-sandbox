#!/usr/bin/env bash
#
# Launch NanoClaw inside a Docker Sandbox using the current `docker sandbox run`
# flow. This replaces the older `docker sandbox create ...` installer path that
# no longer works on newer Docker Sandboxes CLI builds.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/qwibitai/nanoclaw.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"

SUFFIX="$(date +%s | tail -c 5)"
WORKSPACE="${HOME}/nanoclaw-sandbox-${SUFFIX}"
SANDBOX_NAME="nanoclaw-sandbox-${SUFFIX}"

run_help() {
  docker sandbox run --help 2>&1 || true
}

echo ""
echo "=== NanoClaw Docker Sandbox Setup ==="
echo ""
echo "Workspace: ${WORKSPACE}"
echo "Sandbox:   ${SANDBOX_NAME}"
echo ""

if [[ "$(uname -s)" == "Darwin" && "$(uname -m)" != "arm64" ]]; then
  echo "ERROR: Docker Sandboxes currently require Apple Silicon on macOS."
  echo "Use a Mac with Apple Silicon or Docker Desktop on Windows."
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git not found."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker not found."
  echo "Install Docker Desktop 4.58+ and enable Docker Sandboxes."
  exit 1
fi

if ! docker sandbox version </dev/null >/dev/null 2>&1; then
  echo "ERROR: Docker Sandboxes are not available."
  echo "Update Docker Desktop to 4.58+ and enable Docker Sandboxes."
  exit 1
fi

RUN_HELP="$(run_help)"
if ! grep -q "claude" <<<"$RUN_HELP"; then
  echo "ERROR: This Docker sandbox CLI does not expose the Claude agent runtime."
  exit 1
fi

echo "Cloning NanoClaw..."
git clone -b "$REPO_BRANCH" "$REPO_URL" "$WORKSPACE" </dev/null

echo ""
echo "Launching Claude Code inside the sandbox..."
echo "Type /setup when Claude Code starts."
echo ""

if grep -q -- "--workspace" <<<"$RUN_HELP"; then
  docker sandbox run --name "$SANDBOX_NAME" --workspace "$WORKSPACE" claude </dev/tty
else
  docker sandbox run --name "$SANDBOX_NAME" claude "$WORKSPACE" </dev/tty
fi
