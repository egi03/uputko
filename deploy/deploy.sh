#!/bin/sh
# Publishes the public repository's main branch on this server. Installed as ~/deploy.sh; the
# deploy key's line in ~/.ssh/authorized_keys allows this script and nothing else:
#   restrict,command="/home/uputko/deploy.sh" ssh-ed25519 AAAA... github-actions-uputko
# .env and the database (a Docker volume) stay; containers restart only if their image changed.
set -eu
cd "$HOME/uputko"
git fetch --quiet origin main
git reset --hard --quiet origin/main
compose="docker compose --env-file .env -f deploy/docker-compose.yml --profile premium"
$compose build --quiet
$compose up -d --quiet-pull
docker image prune -f >/dev/null
echo "Objavljeno: $(git log -1 --format='%h %s')"
