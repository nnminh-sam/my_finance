#!/usr/bin/env bash
# Injects the haise-adhd output rules into Claude's context.
#   SessionStart (startup|resume|compact|clear): full SKILL.md, so the rules survive compaction.
#   UserPromptSubmit: short reminder, skipped when the prompt asks for a long/detailed/explanatory answer.
set -euo pipefail

SKILL="${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/skills/haise-adhd/SKILL.md"
[ -f "$SKILL" ] || exit 0

input="$(cat)"
event="$(printf '%s' "$input" | jq -r '.hook_event_name // empty')"

emit() {
  jq -n --arg ev "$1" --arg ctx "$2" \
    '{hookSpecificOutput: {hookEventName: $ev, additionalContext: $ctx}}'
}

case "$event" in
  SessionStart)
    body="$(awk 'n<2 && /^---$/ {n++; next} n>=2' "$SKILL")"
    emit SessionStart "haise-adhd mode is ON for this session (auto-enabled by hook). Apply these rules to answers, questions and research write-ups, except when the user explicitly asks for a long, detailed or explanatory answer:

$body"
    ;;
  UserPromptSubmit)
    prompt="$(printf '%s' "$input" | jq -r '.prompt // empty')"
    # Explicit verbose request -> do not push the brevity rules.
    if printf '%s' "$prompt" | grep -qiE '\b(explain|explanation|explanatory|walk me through|in detail|detailed|verbose|long answer|elaborate|deep dive|thorough)\b|chi tiết|giải thích|trả lời dài|viết dài'; then
      emit UserPromptSubmit "haise-adhd: this prompt explicitly asks for a long/detailed/explanatory answer. Explain fully (use headers so it can be skimmed); still no preamble or closing pleasantries."
    else
      emit UserPromptSubmit "haise-adhd mode ON: lead with the next action, number multi-step work, restate state, no tangents/preamble/recap, concrete time estimates, lists max 5 per group, end with one concrete next action."
    fi
    ;;
esac
exit 0
