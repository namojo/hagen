#!/usr/bin/env bash
# hagen 시크릿 스캔 — 파일 쓰기·커밋 입력에서 자격증명 패턴을 차단한다.
INPUT=$(cat)
PATTERNS='AKIA[0-9A-Z]{16}|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|sk-[A-Za-z0-9]{20,}|eyJhbGciOi'
if echo "$INPUT" | grep -qE "$PATTERNS"; then
  echo '{"decision":"block","reason":"자격증명 패턴 감지(API 키/개인키/토큰). 시크릿은 환경변수나 시크릿 매니저로 관리하고, 파일·커밋에 넣지 마라. (hagen 시크릿 스캔)"}'
  exit 0
fi
exit 0
