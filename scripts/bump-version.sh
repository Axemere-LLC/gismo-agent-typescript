#!/usr/bin/env bash
set -euo pipefail

# Bumps this template's own code version (distinct from the agent-version/
# generation axis served at /vN — see docs/serving-multiple-versions.md in
# gismo-agent-hosting). Source of truth is git tags, not a VERSION file:
# `git describe` finds the current version, this script only rewrites
# src/agent/server.ts's VERSION constant and package.json's version so a
# running agent's own logs/handshake, and the package metadata, report the
# build that's actually deployed. Does not commit, tag, or push -- that's
# deploy-agent's Step 0.5, which calls this script and controls the git
# side.
#
# Usage: bump-version.sh <major|minor|patch>

# next_version prints the next semver for $1 (current, X.Y.Z) bumped at
# level $2. Exported as a function so bump-version.test.sh can source this
# file (BASH_SOURCE != 0 below) and test the arithmetic without touching
# src/agent/server.ts or package.json.
next_version() {
  local current="$1" level="$2"
  if [[ ! "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    echo "bump-version.sh: invalid version '$current' (expected X.Y.Z)" >&2
    return 1
  fi
  local major="${BASH_REMATCH[1]}" minor="${BASH_REMATCH[2]}" patch="${BASH_REMATCH[3]}"
  case "$level" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "${major}.$((minor + 1)).0" ;;
    patch) echo "${major}.${minor}.$((patch + 1))" ;;
    *)
      echo "bump-version.sh: unknown level '$level' (expected major|minor|patch)" >&2
      return 1
      ;;
  esac
}

# rewrite_version_ts rewrites the `export const VERSION = "...";` line in
# $1 (a TypeScript file matching src/agent/server.ts's shape) to $2. Split
# out as its own function so bump-version.test.sh can exercise it against a
# temp copy.
rewrite_version_ts() {
  local file="$1" next="$2"
  sed -i.bak "s/^export const VERSION = \"[^\"]*\";$/export const VERSION = \"${next}\";/" "$file"
  rm -f "${file}.bak"
}

# rewrite_version_json rewrites the `"version": "...",` line in $1 (a
# package.json matching this repo's top-of-file shape) to $2.
rewrite_version_json() {
  local file="$1" next="$2"
  sed -i.bak "s/^\(  \"version\": \"\)[^\"]*\(\",\)$/\1${next}\2/" "$file"
  rm -f "${file}.bak"
}

main() {
  local level="${1:-}"
  if [[ "$level" != "major" && "$level" != "minor" && "$level" != "patch" ]]; then
    echo "usage: bump-version.sh <major|minor|patch>" >&2
    exit 1
  fi

  local repo_root
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  local version_ts="$repo_root/src/agent/server.ts"
  local package_json="$repo_root/package.json"

  local current
  if current="$(git -C "$repo_root" describe --tags --match 'v*' --abbrev=0 2>/dev/null)"; then
    current="${current#v}"
  else
    # No tags yet: this is the first release, always 0.1.0 regardless of
    # level — matches gismo-agent-hosting's release skill's first-release rule.
    current="0.0.0"
    level="__first__"
  fi

  local next
  if [[ "$level" == "__first__" ]]; then
    next="0.1.0"
  else
    next="$(next_version "$current" "$level")"
  fi

  rewrite_version_ts "$version_ts" "$next"
  rewrite_version_json "$package_json" "$next"

  echo "$current -> $next"
}

# Only run main when executed directly, not when sourced by the test.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
