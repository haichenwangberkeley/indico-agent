#!/usr/bin/env bash
set -euo pipefail

if [[ -f "$HOME/.indico.sh" ]]; then
  # shellcheck disable=SC1090
  source "$HOME/.indico.sh"
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${PYTHON:-}" ]]; then
  if [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
    PYTHON="$ROOT_DIR/.venv/bin/python"
  else
    PYTHON="python3"
  fi
fi

cd "$ROOT_DIR"
exec "$PYTHON" "$ROOT_DIR/scripts/indico_briefing.py" "$@"
