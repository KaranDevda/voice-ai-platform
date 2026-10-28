# One image recipe for the three services: docker build --build-arg APP=web|voice|worker -f infra/docker/Dockerfile .
# The workspace packages ship TypeScript source, so voice and worker run through tsx and the website through `next start`.
FROM node:22-slim
RUN npm install -g pnpm@12.11.2
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
ARG APP
RUN test -n "$APP" && if [ "$APP" = web ]; then pnpm --filter @voiceai/web build; fi
ENV APP=$APP NODE_ENV=production HOSTNAME=0.0.0.0
RUN chown -R node:node /repo
USER node
CMD ["sh", "infra/docker/start.sh"]
