#!/usr/bin/env bash
# hagen 세션 훅 — 세션 시작·컴팩션 시점에 헌법 핵심 조항을 재주입한다.
# 긴 세션에서 초반에 읽은 규칙은 컨텍스트 압축과 함께 증발한다. 관례가 아니라 이 훅이 규칙을 지킨다.
CONST="docs/constitution.md"
if [ -f "$CONST" ]; then
  echo "=== hagen 헌법 재주입 (요약) ==="
  # 조항 제목 + 각 조항의 첫 비어있지 않은 줄만 주입해 토큰을 아낀다. 전문은 필요 시 파일을 읽는다.
  awk '/^## 제/ { print; want=1; next } want && NF { print; print ""; want=0 }' "$CONST"
  echo "전문: $CONST · 위 조항은 제안이 아니라 필수다."
fi
