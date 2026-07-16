#!/usr/bin/env bun
/**
 * validate.ts — 구조 검증 (Phase 7-1)
 *
 * 사람이 눈으로 확인하면 놓치고, LLM이 확인하면 가끔 넘어간다.
 * frontmatter 완결성 · AGENTS.md 로스터 일치 · 훅 설치 상태는 기계가 검사한다.
 *
 * 사용법: bun scripts/validate.ts [--project .]
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const projectRoot = (() => {
  const i = process.argv.indexOf("--project");
  return i >= 0 ? process.argv[i + 1] : ".";
})();

type Issue = { level: "error" | "warn"; msg: string };
const issues: Issue[] = [];
const err = (msg: string) => issues.push({ level: "error", msg });
const warn = (msg: string) => issues.push({ level: "warn", msg });

function frontmatter(content: string): Record<string, string> | null {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

// 1. 에이전트 정의 검사
const agentsDir = join(projectRoot, ".claude", "agents");
const agentNames: string[] = [];
if (existsSync(agentsDir)) {
  for (const f of readdirSync(agentsDir).filter((f) => f.endsWith(".md"))) {
    const body = readFileSync(join(agentsDir, f), "utf-8");
    const fm = frontmatter(body);
    if (!fm) { err(`agents/${f}: frontmatter 없음`); continue; }
    for (const key of ["name", "description"]) {
      if (!fm[key]) err(`agents/${f}: frontmatter '${key}' 누락`);
    }
    if (fm.name) agentNames.push(fm.name);
    if (fm.description && fm.description.length < 30)
      warn(`agents/${f}: description이 짧음 — 트리거 상황을 구체적으로 (적극적 작성 원칙)`);
    for (const section of ["## 핵심 역할", "## 작업 원칙", "## 핸드오프", "## 에러 처리"]) {
      if (!body.includes(section)) err(`agents/${f}: 필수 섹션 '${section}' 없음`);
    }
    if (!body.includes("## 팀 통신"))
      warn(`agents/${f}: '## 팀 통신' 섹션 없음 — 에이전트 팀 모드라면 필수`);
  }
  if (agentNames.length === 0) err("에이전트 정의가 하나도 없음");
} else {
  err(".claude/agents/ 디렉토리 없음 — Phase 3 미완료");
}

// 2. AGENTS.md 로스터 일치 (SSOT)
const rosterPath = join(projectRoot, "AGENTS.md");
if (existsSync(rosterPath)) {
  const roster = readFileSync(rosterPath, "utf-8");
  for (const name of agentNames) {
    if (!roster.includes(name)) err(`AGENTS.md에 에이전트 '${name}' 미등재 — SSOT 불일치`);
  }
} else {
  err("AGENTS.md 없음 — 거버넌스 주입(Phase 5) 미완료 또는 실패");
}

// 3. 스킬 frontmatter 검사
const skillsDir = join(projectRoot, ".claude", "skills");
if (existsSync(skillsDir)) {
  let hasOrchestrator = false;
  for (const dir of readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const skillPath = join(skillsDir, dir.name, "SKILL.md");
    if (!existsSync(skillPath)) { err(`skills/${dir.name}: SKILL.md 없음`); continue; }
    const body = readFileSync(skillPath, "utf-8");
    if (dir.name.includes("orchestrator") || body.includes("## 단계 정의")) hasOrchestrator = true;
    const fm = frontmatter(body);
    if (!fm?.name || !fm?.description) err(`skills/${dir.name}: frontmatter name/description 누락`);
    const lines = body.split("\n").length;
    if (lines > 500) warn(`skills/${dir.name}: 본문 ${lines}줄 — 500줄 초과분은 references/로 분리 권장`);
  }
  if (!hasOrchestrator) err("오케스트레이터 스킬 없음 — 팀을 엮는 스킬 1개가 필수 (Phase 6)");
}

// 4. 거버넌스 설치 상태
if (!existsSync(join(projectRoot, "docs", "constitution.md"))) err("docs/constitution.md 없음");
if (!existsSync(join(projectRoot, "_workspace"))) err("_workspace/ 없음");
const settingsPath = join(projectRoot, ".claude", "settings.json");
if (existsSync(settingsPath)) {
  const s = JSON.parse(readFileSync(settingsPath, "utf-8"));
  if (!s.hooks?.SessionStart) err("세션 훅 미설치 — 헌법 재주입이 동작하지 않음");
} else {
  err(".claude/settings.json 없음 — 훅 전체 미설치");
}

// 5. 팀 결선 검사 — 오케스트레이터 담당 열의 에이전트가 로스터에 실존하는가
let teamMode = false;
if (existsSync(skillsDir)) {
  for (const dir of readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const p = join(skillsDir, dir.name, "SKILL.md");
    if (!existsSync(p)) continue;
    const body = readFileSync(p, "utf-8");
    if (!body.includes("## 단계 정의")) continue;
    if (body.includes("에이전트 팀")) teamMode = true;
    // 단계 표의 담당(2번째 열)에서 영문 슬러그 추출해 로스터 대조
    for (const row of body.split("\n").filter((l) => /^\|\s*\d/.test(l))) {
      const cols = row.split("|").map((c) => c.trim());
      const owner = cols[2]?.match(/[a-z][a-z0-9-]{2,}/)?.[0];
      if (owner && !agentNames.includes(owner))
        err(`오케스트레이터 담당 '${owner}': .claude/agents/에 정의 없음 — dead link`);
    }
  }
}
if (teamMode) {
  for (const f of existsSync(agentsDir) ? readdirSync(agentsDir).filter((f) => f.endsWith(".md")) : []) {
    if (!readFileSync(join(agentsDir, f), "utf-8").includes("## 팀 통신"))
      err(`agents/${f}: 팀 모드인데 '## 팀 통신' 없음 — 메시지 경로 미정의`);
  }
}

// 6. 핸드오프 dead link (오케스트레이터가 참조하는 단계 산출물 경로 점검)
// _workspace 파일명 컨벤션 준수 여부만 가볍게 확인 (실행 전이므로 존재 검사는 생략)
const wsDir = join(projectRoot, "_workspace");
if (existsSync(wsDir)) {
  const stray = readdirSync(wsDir).filter(
    (f) => f.endsWith(".md") && !/^\d{2}_[a-z0-9-]+_/.test(f)
  );
  for (const f of stray) warn(`_workspace/${f}: 파일명 컨벤션({phase}_{agent}_{artifact}, 영문) 미준수`);
}

// ---------- 결과 ----------
const errors = issues.filter((i) => i.level === "error");
const warns = issues.filter((i) => i.level === "warn");
for (const i of issues) console.log(`${i.level === "error" ? "✖" : "△"} ${i.msg}`);
console.log(`\n검증 결과: 오류 ${errors.length} · 경고 ${warns.length}`);
if (errors.length > 0) {
  console.error("✖ 스캐폴딩 미완료 — 오류를 해결한 뒤 재검증하세요.");
  process.exit(1);
}
console.log("✔ 구조 검증 통과. 다음: 품질 게이트(7/10) + 트리거 검증(Phase 7-2~7-4)");
