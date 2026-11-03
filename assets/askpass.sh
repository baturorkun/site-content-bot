#!/bin/sh
# git's GIT_ASKPASS for the bot's pushes: the GitLab project token from the
# container's environment, never written into the clone's remote URL.
case $1 in
  Username*) echo oauth2 ;;
  *) printf '%s\n' "$CONTENT_BOT_GITLAB_TOKEN" ;;
esac
