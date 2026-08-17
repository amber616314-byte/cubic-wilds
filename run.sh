#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
node tools/server.mjs "${1:-8080}"
