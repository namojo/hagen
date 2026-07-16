#!/usr/bin/env bash
# hagen careful 훅 — 파괴적 명령 실행 전 경고. stdin으로 tool 입력 JSON을 받는다.
INPUT=$(cat)
CMD=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1)
PATTERNS='rm -rf|rm -fr|DROP TABLE|DROP DATABASE|force-push|push --force|push -f |git reset --hard|mkfs|:(){ :|dd if='
if echo "$CMD" | grep -qE "$PATTERNS"; then
  echo '{"decision":"block","reason":"파괴적 명령 감지. 정말 의도한 작업이면 사용자에게 확인을 받은 뒤, 확인 사실을 명시하고 재시도하라. (hagen careful 게이트)"}'
  exit 0
fi
exit 0
