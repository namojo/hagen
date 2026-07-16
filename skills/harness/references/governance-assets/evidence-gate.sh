#!/usr/bin/env bash
# hagen 증거 게이트 — 완료 선언 시 증거를 요구한다. 완료는 주장이 아니라 획득이다.
# Stop 훅: 대화 종료 직전 마지막 어시스턴트 발화에 완료 선언이 있는지 휴리스틱 검사.
INPUT=$(cat)
if echo "$INPUT" | grep -qE '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then exit 0; fi
LAST=$(echo "$INPUT" | tail -c 4000)
if echo "$LAST" | grep -qE '완료했|완료됐|완성했|done|completed|finished'; then
  if ! echo "$LAST" | grep -qE '_workspace/|테스트.*(통과|성공)|test.*(pass|passed)|acceptance'; then
    echo '{"decision":"block","reason":"완료 선언에 증거가 없다. 산출 파일 경로(_workspace/...) 또는 테스트 통과 기록 또는 충족된 acceptance 항목을 제시하고 종료하라. (hagen 증거 게이트)"}'
    exit 0
  fi
fi
exit 0
