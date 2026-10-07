#!/usr/bin/env bash
# Posts a file as the pull request's benchmark comment. A pull request has one
# such comment, found by the marker on its first line, so a new run replaces
# what the last one left instead of adding to it.
#
#   PR=<number> GH_TOKEN=<token> bench/post-comment.sh <file>
set -euo pipefail

existing=$(gh api "repos/$GITHUB_REPOSITORY/issues/$PR/comments" --paginate \
  --jq '.[] | select(.body | startswith("<!-- sia-storage-bench -->")) | .id' | head -n 1)
if [ -n "$existing" ]; then
  gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$existing" -F body=@"$1" >/dev/null
else
  gh pr comment "$PR" --repo "$GITHUB_REPOSITORY" --body-file "$1"
fi
