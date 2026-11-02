#!/usr/bin/env bash
# Vercel Ignored Build Step for deskohub-portal (vercel.json `ignoreCommand`).
# Vercel cancels the build on exit 0 and builds on exit 1.
#
# The portal builds unless every file changed since the branch's last
# successful deployment is known not to reach the portal's install or build.
# Anything uncertain builds: a missing, malformed, unreachable or unrelated
# previous commit, a redeploy of the same commit, an empty diff (an empty
# commit is a common way to request a redeploy), any Git error, and any path
# not listed as unrelated below.
set -u

build() {
  echo "deskohub-portal: building: $1"
  exit 1
}

skip() {
  echo "deskohub-portal: skipping build: $1"
  exit 0
}

# Paths that cannot change the portal's install or build. The portal has no
# workspace dependencies, so other apps' and packages' sources are unrelated;
# their manifests still take part in the shared `bun install`.
is_unrelated_path() {
  case "$1" in
  package.json | */package.json | bunfig.toml | */bunfig.toml | .npmrc | */.npmrc)
    return 1
    ;;
  apps/deskohub-portal/*)
    return 1
    ;;
  apps/*/* | packages/*/*)
    return 0
    ;;
  .agents/* | .github/* | .opencode/* | lint/* | scripts/*)
    return 0
    ;;
  AGENTS.md | README.md | biome.json | knip.jsonc | next-env.d.ts | \
    .release-please-manifest.json | release-please-config.json)
    return 0
    ;;
  *)
    return 1
    ;;
  esac
}

previous="${VERCEL_GIT_PREVIOUS_SHA:-}"
[ -n "$previous" ] || build "no previous successful deployment on this branch"
[[ "$previous" =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]] ||
  build "previous deployment commit '$previous' is not a full commit hash"

root="$(git rev-parse --show-toplevel 2>/dev/null)" ||
  build "not inside a Git checkout"
current="$(git -C "$root" rev-parse --verify --quiet 'HEAD^{commit}')" ||
  build "cannot resolve HEAD"
if [ -n "${VERCEL_GIT_COMMIT_SHA:-}" ] && [ "$VERCEL_GIT_COMMIT_SHA" != "$current" ]; then
  build "HEAD $current is not the deployment commit $VERCEL_GIT_COMMIT_SHA"
fi
[ "$previous" != "$current" ] || build "redeploy of $current"

git -C "$root" cat-file -e "$previous^{commit}" 2>/dev/null ||
  build "previous deployment commit $previous is not in the clone"
git -C "$root" merge-base --is-ancestor "$previous" "$current" 2>/dev/null ||
  build "previous deployment commit $previous is not an ancestor of $current"

changes="$(mktemp)" || build "cannot create a temporary file"
trap 'rm -f "$changes"' EXIT
git -C "$root" -c core.quotePath=false diff --no-relative --no-renames \
  --no-ext-diff --ignore-submodules=none --name-only -z \
  "$previous" "$current" >"$changes" ||
  build "git diff failed"
[ -s "$changes" ] || build "no file changes since $previous"

count=0
while IFS= read -r -d '' path; do
  is_unrelated_path "$path" || build "$path changed since $previous"
  count=$((count + 1))
done <"$changes"
[ "$count" -gt 0 ] || build "could not read the changed files"

skip "$count changed files since $previous are all unrelated to the portal"
