#!/usr/bin/env bash
# Live-host verification. Exit codes: 0 all registered, 10 web UI unreachable,
# 11 plugin link or skills path broken, 12 plugin module failed to load,
# 13 profile package.json missing dependency or bundle entry, 14 catalog count
# mismatch. The lowest failing code wins.
set -u

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_URL="${DSH_WEB_URL:-http://127.0.0.1:13080}"
EXPECTED_SKILLS=9
EXPECTED_WORKFLOWS=5
EXPECTED_COMMANDS=10

resolve_profile() {
  local candidates=()
  if [ -n "${DSH_PROFILE:-}" ]; then
    case "$DSH_PROFILE" in
      /*) candidates+=("$DSH_PROFILE") ;;
      *)
        for base in "${DSH_HOME:-}/profiles" "$HOME/.dsh/profiles"; do
          [ -n "$base" ] && candidates+=("$base/$DSH_PROFILE")
        done
        ;;
    esac
  fi
  candidates+=("$HOME/.dsh/profiles/web" "${DSH_HOME:-}/profiles/web")
  for candidate in "${candidates[@]}"; do
    if [ -f "$candidate/package.json" ] && [ -d "$candidate/node_modules" ]; then
      echo "$candidate"
      return
    fi
  done
  echo "${candidates[0]}"
}

PROFILE_DIR="$(resolve_profile)"

fail() {
  echo "FAIL: $1"
  exit "$2"
}

STATUS_CODE="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "$WEB_URL" 2>/dev/null)"
case "$STATUS_CODE" in
  [1-5][0-9][0-9]) ;;
  *) fail "host web UI unreachable at $WEB_URL" 10 ;;
esac

LINK="$PROFILE_DIR/node_modules/dsh-flowgate"
[ -e "$LINK" ] || fail "plugin symlink missing at $LINK; run npm install in $PROFILE_DIR with a link: dependency" 11
[ -f "$LINK/lib/index.js" ] || fail "plugin link $LINK does not resolve to the plugin" 11

SKILLS_PATH="$(grep -oE '/[A-Za-z0-9_./-]+/assets/skills' "$PLUGIN_DIR/cordis.patch.yml" | head -1)"
if [ -z "$SKILLS_PATH" ]; then
  fail "cordis.patch.yml carries no customSkillDirs path" 11
fi
[ -d "$SKILLS_PATH" ] || fail "customSkillDirs path does not exist: $SKILLS_PATH" 11
case "$SKILLS_PATH" in
  "$PLUGIN_DIR"/*) ;;
  *) fail "customSkillDirs path does not point at the plugin: $SKILLS_PATH (substitute $PLUGIN_DIR/assets/skills)" 11 ;;
esac

(cd "$PROFILE_DIR" && node --input-type=module -e "await import('dsh-flowgate')" >/dev/null 2>&1) \
  || fail "plugin module failed to load from $PROFILE_DIR" 12

node -e "
const profile = require('$PROFILE_DIR/package.json')
const deps = profile.dependencies ?? {}
const bundles = profile.dsh?.profile?.bundles ?? []
if (!deps['dsh-flowgate'] || !bundles.includes('dsh-flowgate')) process.exit(1)
" || fail "profile package.json is missing the dsh-flowgate dependency or bundle entry" 13

grep -q 'id: dsh-flowgate' "$PLUGIN_DIR/cordis.patch.yml" \
  || fail "plugin cordis.patch.yml is missing the dsh-flowgate bundle row" 13
grep -q 'id: flowgate-skills' "$PLUGIN_DIR/cordis.patch.yml" \
  || fail "plugin cordis.patch.yml is missing the flowgate-skills provider row" 13

node --input-type=module -e "
import { derivedCounts } from '$LINK/lib/counts.js'
const counts = derivedCounts()
if (counts.skills !== $EXPECTED_SKILLS || counts.workflows !== $EXPECTED_WORKFLOWS || counts.commands !== $EXPECTED_COMMANDS) {
  console.error(JSON.stringify(counts))
  process.exit(1)
}
" || fail "catalog count mismatch (expected $EXPECTED_SKILLS skills, $EXPECTED_WORKFLOWS workflows, $EXPECTED_COMMANDS commands)" 14

echo "OK: host reachable at $WEB_URL; plugin linked, loaded, and wired; catalog counts match ($EXPECTED_SKILLS skills, $EXPECTED_WORKFLOWS workflows, $EXPECTED_COMMANDS commands)"
exit 0
