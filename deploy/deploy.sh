#!/usr/bin/env bash
#
# Push this project to an EC2 instance already prepared with
# deploy/setup-ec2.sh.
#
# Run from the project root on your own machine (macOS or Linux/Git Bash):
#
#   ./deploy/deploy.sh -h 54.165.23.891 -i ./login.pem
#
# What it does:
#   1. Run tests locally -- refuses to deploy if anything's broken.
#   2. Copy the source to /opt/black-forest on the server with tar over ssh
#      (node_modules, .git and the server's own data file are left behind).
#   3. Install production dependencies there and seed the world data.
#   4. Restart the black-forest systemd service.
#   5. Check GET /health on the server to confirm the deploy succeeded.
#
# Options:
#   -h HOST   public IP or DNS name of the instance   (required)
#   -i KEY    path to your .pem private key           (optional if ssh-agent has it)
#   -u USER   SSH login user (default: ubuntu; use 'ec2-user' for Amazon Linux)
#   -d DIR    remote directory (default: /opt/black-forest)

set -euo pipefail

REMOTE_HOST=""
SSH_KEY=""
REMOTE_USER="ubuntu"
REMOTE_DIR="/opt/black-forest"
SERVICE="black-forest"

usage() {
    awk 'NR>1 { if (/^#/) { sub(/^# ?/, ""); print } else { exit } }' "$0"
    exit 1
}

while getopts ":h:i:u:d:" option; do
    case "$option" in
        h) REMOTE_HOST="$OPTARG" ;;
        i) SSH_KEY="$OPTARG" ;;
        u) REMOTE_USER="$OPTARG" ;;
        d) REMOTE_DIR="$OPTARG" ;;
        :) echo "ERROR: -$OPTARG needs a value" >&2; usage ;;
        \?) echo "ERROR: unknown option -$OPTARG" >&2; usage ;;
    esac
done

[ -n "$REMOTE_HOST" ] || { echo "ERROR: -h HOST is required" >&2; usage; }

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

[ -f package.json ] || { echo "ERROR: no package.json in $PROJECT_DIR" >&2; exit 1; }

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
if [ -n "$SSH_KEY" ]; then
    [ -f "$SSH_KEY" ] || { echo "ERROR: key file not found: $SSH_KEY" >&2; exit 1; }
    SSH_OPTS+=(-i "$SSH_KEY")
fi

TARGET="${REMOTE_USER}@${REMOTE_HOST}"

echo "==> Running tests before deploying"
npm test

echo "==> Copying files to ${TARGET}:${REMOTE_DIR}"
# Git for Windows doesn't bundle rsync, so tar piped over ssh is used instead
# -- a standard substitute. This does a full copy every time rather than an
# incremental diff (so it won't remove files on the server that you deleted
# locally, unlike rsync --delete), but that's a fine tradeoff at this size.
ssh "${SSH_OPTS[@]}" "$TARGET" "mkdir -p '${REMOTE_DIR}'"
tar czf - \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='data' \
    --exclude='*.pem' \
    --exclude='.env' \
    --exclude='.DS_Store' \
    --exclude='*.log' \
    . | ssh "${SSH_OPTS[@]}" "$TARGET" "tar xzf - -C '${REMOTE_DIR}'"

echo "==> Installing dependencies, seeding, and restarting the service"
ssh "${SSH_OPTS[@]}" "$TARGET" "
    set -e
    cd '${REMOTE_DIR}'
    npm ci --omit=dev
    npm run seed
    sudo systemctl restart ${SERVICE}
    sleep 2
    sudo systemctl is-active --quiet ${SERVICE} && echo 'service is running'
"

echo "==> Checking the health endpoint"
if curl -fsS --max-time 10 "http://${REMOTE_HOST}/health"; then
    printf '\n\n==> Deployed. Open http://%s in your browser.\n' "$REMOTE_HOST"
else
    printf '\n'
    echo "WARNING: the health check did not answer." >&2
    echo "Check the EC2 security group (port 80 inbound) and the logs:" >&2
    echo "  ssh ${SSH_OPTS[*]} $TARGET 'journalctl -u ${SERVICE} -n 50'" >&2
    exit 1
fi