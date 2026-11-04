# The site-content-bot image (RQ-0005), published to GHCR by
# .github/workflows/image.yml on every v* tag. Built from the tarball the
# workflow packs from the tagged commit (npm pack), so it runs exactly that
# code and does not wait for npm:
#   docker build --build-arg TARBALL=site-content-bot-<version>.tgz -f docker/Dockerfile .
# A site that needs more tools for its build or checks makes its own image
# FROM this one and names it in CONTENT_BOT_IMAGE.
# glibc, not alpine: the claude CLI's native parts expect it.
FROM node:20-bookworm-slim

ARG TARBALL
ARG VERSION=dev

LABEL org.opencontainers.image.source="https://github.com/baturorkun/site-content-bot" \
      org.opencontainers.image.description="A chat that reads a website's repository and changes its texts" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# The two language model CLIs (CONTENT_BOT_LLM chooses; their logins live in
# /data/home), pnpm and yarn for the site's build and checks, and the bot.
ENV COREPACK_HOME=/opt/corepack
COPY ${TARBALL} /tmp/site-content-bot.tgz
RUN npm install --global @anthropic-ai/claude-code@2.1.312 @openai/codex@0.166.0 /tmp/site-content-bot.tgz \
  && rm /tmp/site-content-bot.tgz \
  && corepack enable \
  && corepack prepare pnpm@9.15.9 --activate \
  && corepack prepare yarn@1.22.22 --activate \
  && chmod -R a+rX /opt/corepack

# /data is the volume: the clone (repo/), the copies the model reads (site/)
# and the claude and codex logins (home/).
RUN mkdir -p /data/home && chown -R node:node /data
VOLUME /data
ENV HOME=/data/home \
    CONTENT_BOT_REPO_DIR=/data/repo \
    CONTENT_BOT_SITE_DIR=/data/site \
    CONTENT_BOT_PORT=8290
USER node
EXPOSE 8290
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:8290/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["site-content-bot", "serve"]
