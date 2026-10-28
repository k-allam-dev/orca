import { BUNDLE_REF } from './windows-bundle'
import { SANDBOX_BASE_BRANCH } from '../../../shared/autosfactory/sandbox-config'

// Runs as afrepos with the bundle on stdin; args: <repos dir> <repoKey>.
export const UPDATE_REPO_SCRIPT = `#!/bin/bash
set -eu
umask 022
repo="$1/$2.git"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/in.bundle"
if [ ! -d "$repo" ]; then
  git init --bare -q "$repo"
fi
git -C "$repo" fetch -q --update-head-ok --force "$tmp/in.bundle" '+${BUNDLE_REF}:refs/heads/${SANDBOX_BASE_BRANCH}'
git -C "$repo" symbolic-ref HEAD refs/heads/${SANDBOX_BASE_BRANCH}
`
