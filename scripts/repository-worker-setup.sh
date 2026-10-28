#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
context="${PASSAGE_REPOSITORY_CONTEXT:-colima-passage}"
docker --context "$context" info --format '{{.OSType}}'
docker --context "$context" build -t passage-react-worker:v1 scripts/repository-worker-image
mkdir -p .passage/repository-worker
image=$(docker --context "$context" image inspect passage-react-worker:v1 --format '{{.Id}}')
node -e 'require("node:fs").writeFileSync(".passage/repository-worker/runtime.json",JSON.stringify({context:process.argv[1],image:process.argv[2]},null,2))' "$context" "$image"
