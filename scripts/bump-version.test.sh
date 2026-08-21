#!/usr/bin/env bash
set -uo pipefail

# Table-driven test for bump-version.sh's next_version arithmetic, plus
# cases exercising rewrite_version_ts and rewrite_version_json against temp
# copies. Sources the script (which no-ops its main() when sourced) rather
# than shelling out, so src/agent/server.ts and package.json are never
# touched.
#
# Usage: bump-version.test.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=bump-version.sh
source "$SCRIPT_DIR/bump-version.sh"

fail=0

# $1 = current, $2 = level, $3 = expected next version (or "ERROR")
check() {
  local current="$1" level="$2" expected="$3"
  local got
  if got="$(next_version "$current" "$level" 2>/dev/null)"; then
    if [ "$expected" = "ERROR" ]; then
      echo "FAIL next_version($current, $level) = '$got', expected an error"
      fail=1
    elif [ "$got" != "$expected" ]; then
      echo "FAIL next_version($current, $level) = '$got', expected '$expected'"
      fail=1
    else
      echo "OK   next_version($current, $level) = $got"
    fi
  else
    if [ "$expected" = "ERROR" ]; then
      echo "OK   next_version($current, $level) correctly errored"
    else
      echo "FAIL next_version($current, $level) errored, expected '$expected'"
      fail=1
    fi
  fi
}

# Field carries across double digits — a naive string-increment would break
# 0.9.0 -> 1.0.0 instead of 0.10.0.
check "0.9.0" "minor" "0.10.0"
check "0.1.9" "patch" "0.1.10"
# minor resets patch; major resets both.
check "1.2.3" "minor" "1.3.0"
check "1.2.3" "major" "2.0.0"
check "0.1.0" "patch" "0.1.1"
check "1.2.3" "patch" "1.2.4"
# Malformed input and unknown level both reject rather than guessing.
check "1.2" "patch" "ERROR"
check "1.2.3" "revision" "ERROR"
check "v1.2.3" "patch" "ERROR"

# rewrite_version_ts: run against a temp copy, never the real file.
tmp_ts="$(mktemp)"
tmp_json="$(mktemp)"
trap 'rm -f "$tmp_ts" "${tmp_ts}.bak" "$tmp_json" "${tmp_json}.bak"' EXIT
cat > "$tmp_ts" <<'EOF'
export const NAME = "gismo-agent-typescript";

/** doc comment */
export const VERSION = "0.1.0";
EOF
rewrite_version_ts "$tmp_ts" "0.2.0"
if grep -q '^export const VERSION = "0.2.0";$' "$tmp_ts"; then
  echo "OK   rewrite_version_ts wrote VERSION = \"0.2.0\""
else
  echo "FAIL rewrite_version_ts did not update VERSION as expected"
  fail=1
fi
if grep -q '^export const NAME = "gismo-agent-typescript";$' "$tmp_ts"; then
  echo "OK   rewrite_version_ts left NAME untouched"
else
  echo "FAIL rewrite_version_ts modified an unrelated line"
  fail=1
fi

# rewrite_version_json: run against a temp copy, never the real file.
cat > "$tmp_json" <<'EOF'
{
  "name": "@gismo/agent-typescript",
  "version": "0.1.0",
  "description": "TypeScript starter template for a Gismo competitor agent"
}
EOF
rewrite_version_json "$tmp_json" "0.2.0"
if grep -q '^  "version": "0.2.0",$' "$tmp_json"; then
  echo "OK   rewrite_version_json wrote \"version\": \"0.2.0\""
else
  echo "FAIL rewrite_version_json did not update version as expected"
  fail=1
fi
if grep -q '^  "name": "@gismo/agent-typescript",$' "$tmp_json"; then
  echo "OK   rewrite_version_json left name untouched"
else
  echo "FAIL rewrite_version_json modified an unrelated line"
  fail=1
fi

echo
if [ "$fail" -ne 0 ]; then
  echo "bump-version.test.sh: FAILED"
  exit 1
fi

echo "bump-version.test.sh: all cases pass"
