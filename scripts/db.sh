#!/bin/bash
# Connect to Reverie Postgres. Usage:
#   ./scripts/db.sh              # interactive psql
#   ./scripts/db.sh -c "SELECT * FROM users"
set -euo pipefail
cd "$(dirname "$0")/.."
docker exec -it reverie-postgres psql -U reverieadmin -d reverie "$@"
