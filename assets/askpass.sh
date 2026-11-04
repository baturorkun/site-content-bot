#!/bin/sh
# git's GIT_ASKPASS for the bot's pushes: the platform token from the
# container's environment, never written into the clone's remote URL. The
# user name is what the platform expects beside a token (oauth2 on GitLab,
# x-access-token on GitHub); the bot sets it.
case $1 in
  Username*) printf '%s\n' "${CONTENT_BOT_GIT_USER:-oauth2}" ;;
  *) printf '%s\n' "$CONTENT_BOT_TOKEN" ;;
esac
