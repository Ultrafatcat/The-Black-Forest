#!/usr/bin/env bash
#
# Start The Black Forest on your own machine.
#
#   ./start.sh              start the app on http://localhost:3000
#   ./start.sh --dev        restart automatically when you save a file
#   ./start.sh --port 4000  listen somewhere other than port 3000
#   ./start.sh --help       show this message
#
# Works on macOS and Linux.

set -euo pipefail

REQUIRED_NODE_MAJOR=20   # keep this in sync with package.json's "engines"

DEV_MODE="false"
PORT_OVERRIDE=""

say() { printf '==> %s\n' "$1"; }
die() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

usage() {
    awk 'NR>1 { if (/^#/) { sub(/^# ?/, ""); print } else { exit } }' "$0"
    exit 0
}

while [ $# -gt 0 ]; do
    case "$1" in
        -d|--dev) DEV_MODE="true"; shift ;;
        -p|--port)
            [ $# -ge 2 ] || die "--port needs a number, for example: --port 4000"
            case "$2" in ''|*[!0-9]*) die "--port needs a number, got '$2'" ;; esac
            PORT_OVERRIDE="$2"; shift 2 ;;
        -h|--help) usage ;;
        *) die "unknown option '$1' (try --help)" ;;
    esac
done

# Run from the project root no matter where this was called from -- this is
# what makes it safe to run from a fresh clone regardless of cwd.
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# --- requirement 1: check tools, stop with a clear message --------------

command -v node >/dev/null 2>&1 \
    || die "Node.js is not installed. Get it from https://nodejs.org (version ${REQUIRED_NODE_MAJOR} or newer)."

if ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= ${REQUIRED_NODE_MAJOR} ? 0 : 1)"; then
    die "Node $(node --version) is too old. This app needs version ${REQUIRED_NODE_MAJOR} or newer."
fi

command -v npm >/dev/null 2>&1 || die "npm is not installed, but Node.js is. Reinstall Node from https://nodejs.org."

# --- requirement 2: install every dependency -----------------------------

[ -f package.json ] || die "no package.json here. Run this script from inside the project folder."

INSTALL_MARKER="node_modules/.package-lock.json"
if [ ! -d node_modules ]; then
    say "Installing dependencies (this happens once, and takes a moment)"
    npm install
elif [ ! -f "$INSTALL_MARKER" ] || [ package-lock.json -nt "$INSTALL_MARKER" ]; then
    say "Dependencies changed since your last install, updating them"
    npm install
fi

# --- requirement 3: create anything needed before first run -------------

say "Checking the database"
npm run seed --silent

# --- requirement 4: start the app and print the URL ----------------------

if [ -n "$PORT_OVERRIDE" ]; then
    export PORT="$PORT_OVERRIDE"
fi

PORT_IN_USE="${PORT_OVERRIDE:-3000}"
say "Starting on http://localhost:${PORT_IN_USE} -- press Ctrl+C to stop"

if [ "$DEV_MODE" = "true" ]; then
    say "Dev mode: the server restarts when you save a file"
    exec node --watch server/server.js
fi

exec node server/server.js