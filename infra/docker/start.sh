#!/bin/sh
# Starts the service named by $APP. The one-off "migrate" job reuses the image: its task overrides the command.
set -e
case "$APP" in
  web) cd apps/web && exec pnpm exec next start -p "${PORT:-3000}" ;;
  voice) cd apps/voice && exec pnpm exec tsx src/index.ts ;;
  worker) cd apps/worker && exec pnpm exec tsx src/index.ts ;;
  *) echo "APP must be web, voice or worker" >&2; exit 1 ;;
esac
