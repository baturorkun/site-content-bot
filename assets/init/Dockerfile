# site-content-bot for this site. Built from this directory alone; the site's
# repository is cloned at run time into the /data volume:
#   docker compose -f tools/content-bot/compose.yaml up -d --build
# glibc, not alpine: the claude CLI's native parts expect it.
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# The claude CLI (the subscription login lives in /data/home), the bot, and
# pnpm for the site's build and checks in the clone.
ENV COREPACK_HOME=/opt/corepack
RUN npm install --global @anthropic-ai/claude-code@2.1.312 site-content-bot@{{version}} \
  && corepack enable \
  && corepack prepare pnpm@9.15.9 --activate \
  && chmod -R a+rX /opt/corepack

# /data is the volume: the clone (repo/), the copies the model reads (site/)
# and the claude login (home/).
RUN mkdir -p /data/home && chown -R node:node /data
ENV HOME=/data/home \
    CONTENT_BOT_REPO_DIR=/data/repo \
    CONTENT_BOT_SITE_DIR=/data/site \
    CONTENT_BOT_PORT=8290
USER node
EXPOSE 8290
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8290/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["site-content-bot", "serve"]
