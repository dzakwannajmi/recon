#!/bin/sh
# Points this clone at the tracked hooks in frontend/scripts/hooks. Run from anywhere: `npm run hooks:install`.
set -e
root=$(git rev-parse --show-toplevel)
chmod +x "$root/frontend/scripts/hooks/pre-commit"
git -C "$root" config core.hooksPath frontend/scripts/hooks
echo "hooks installed: core.hooksPath = frontend/scripts/hooks"
