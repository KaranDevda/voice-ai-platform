#!/usr/bin/env bash
# Keeps the post-call worker running (it analyses finished calls: summary, sentiment, next step, lead status). Restarts it if it exits.
# Started by pnpm dev:stack; can also be run alone with pnpm dev:worker.
cd "$(dirname "$0")/../apps/worker" || exit 1
child=""
trap '[ -n "$child" ] && kill "$child" 2>/dev/null; exit 0' INT TERM
while true; do
  pnpm exec tsx src/index.ts &
  child=$!
  wait "$child"
  echo "[$(date +%T)] the post-call worker stopped; restarting in 3 seconds" >&2
  sleep 3
done
