#!/usr/bin/env bun
/**
 * assert-harness.ts — 메타 스킬 인수 테스트 (Phase 7 확장)
 *
 * validate.ts가 "구조가 성립하는가"를 본다면, 이 테스트는
 * "메타 스킬(SKILL.md)이 약속한 산출물 품질이 실제로 지켜졌는가"를 본다.
 * hagen가 생성한 하네스라면 어떤 도메인이든 이 테스트를 통과해야 한다.
 *
 * 사용법: bun tests/assert-harness.ts --project <경로> --profile <light|standard|strict>
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const root = arg("project", ".")!;
const profile = arg("profile", "standard")!;

let pass = 0, fail = 0;
const ok = (name: string) => { pass++; console.log(`✔ ${name}`); };
const no = (name: string, why: string) => { fail++; console.log(`✖ ${name} — ${why}`); };
const check = (name: string, cond: boolean, why: string) => (cond ? ok(name) : no(name, why));

// ---------- A. 오케스트레이터 품질 ----------
const skillsDir = join(root, ".claude", "skills");
let orch = "";
if (existsSync(skillsDir)) {
  for (const d of readdirSync(skillsDir, { withFileTypes: true }).filter((x) => x.isDirectory())) {
    const p = join(skillsDir, d.name, "SKILL.md");
    if (!existsSync(p)) continue;
    const body = readFileSync(p, "utf-8");
    if (d.name.includes("orchestrator") || body.includes("## 단계 정의")) orch = body;
  }
}
check("A1 오케스트레이터 존재", orch.length > 0, "orchestrator 스킬 없음");
if (orch) {
  check("A2 단계 정의 표에 게이트 열", /단계 정의[\s\S]*?\|\s*게이트\s*\|/.test(orch), "게이트 열 누락 — 스마트 라우팅 불가");
  check("A3 에러 대응 표에 상한", /에러 대응[\s\S]*?상한/.test(orch), "재시도 상한 미명시 — 무한 재시도 위험");
  check("A4 테스트 시나리오(정상+에러)", orch.includes("테스트 시나리오") && orch.includes("정상") && /에러|반려/.test(orch), "정상+에러 흐름 시나리오 필수");
  check("A5 에스컬레이션 조건 존재", orch.includes("에스컬레이션"), "사람에게 넘기는 조건 미정의");
  check("A6 적용 패턴 선언", orch.includes("## 적용 패턴") || orch.includes("적용 패턴"), "어떤 패턴 조합인지 미선언 — 단계 표와의 정합 검증 불가");
}

// ---------- B. 에이전트 핸드오프 실질성 ----------
const agentsDir = join(root, ".claude", "agents");
if (existsSync(agentsDir)) {
  for (const f of readdirSync(agentsDir).filter((f) => f.endsWith(".md"))) {
    const body = readFileSync(join(agentsDir, f), "utf-8");
    const ho = body.split("## 핸드오프")[1]?.split("##")[0] ?? "";
    check(`B ${f}: 핸드오프에 _workspace 경로`, ho.includes("_workspace/"), "입출력이 파일 경로로 특정되지 않음 — dead link 위험");
  }
}

// ---------- C. 스킬 description 경계 조항 ----------
if (existsSync(skillsDir)) {
  for (const d of readdirSync(skillsDir, { withFileTypes: true }).filter((x) => x.isDirectory())) {
    const p = join(skillsDir, d.name, "SKILL.md");
    if (!existsSync(p)) continue;
    const desc = readFileSync(p, "utf-8").match(/^description:\s*["']?([\s\S]*?)["']?\s*$/m)?.[1] ?? "";
    check(`C ${d.name}: description에 부정 경계("...않는다")`, desc.includes("않는다"), "near-miss 오발화 방지 조항 없음");
  }
}

// ---------- D. 기록 계층 ----------
const dec = join(root, "_workspace", "decisions");
check("D1 설계 결정 기록 존재", existsSync(dec) && readdirSync(dec).length > 0, "Phase 8 미수행 — 개선 불가능한 하네스");

// ---------- E. 프로파일 정합성 (설치된 게이트가 티어와 일치하는가) ----------
const settingsPath = join(root, ".claude", "settings.json");
const settings = existsSync(settingsPath) ? readFileSync(settingsPath, "utf-8") : "";
const hasEvidence = settings.includes("evidence-gate");
const hasPrePush = existsSync(join(root, ".githooks", "pre-push"));
if (profile === "light") {
  check("E1 light: 증거 게이트 미설치", !hasEvidence, "light에 standard 게이트가 설치됨 — 과잉");
  check("E2 light: pre-push 미설치", !hasPrePush, "light에 strict 게이트가 설치됨 — 과잉");
} else if (profile === "standard") {
  check("E1 standard: 증거 게이트 설치", hasEvidence, "standard 핵심 게이트 누락");
  check("E2 standard: pre-push 미설치", !hasPrePush, "standard에 strict 게이트 — 과잉");
} else {
  check("E1 strict: 증거 게이트 설치", hasEvidence, "게이트 누락");
  check("E2 strict: pre-push 존재", hasPrePush, "PR-only 미설치");
  if (existsSync(join(root, ".git"))) {
    let hooksPath = "";
    try { hooksPath = execSync("git config core.hooksPath", { cwd: root }).toString().trim(); } catch {}
    check("E3 strict: git hooksPath 활성화", hooksPath === ".githooks", "pre-push가 있어도 core.hooksPath 미설정이면 무용지물");
  }
}

// ---------- E4. 훅 등록 위생 (모든 티어 공통) ----------
if (settings) {
  const parsed = JSON.parse(settings);
  let dup = 0, dangling = 0, legacy = 0;
  for (const event of Object.keys(parsed.hooks ?? {})) {
    const cmds: string[] = [];
    for (const entry of parsed.hooks[event]) {
      for (const h of entry.hooks ?? []) {
        if (cmds.includes(h.command)) dup++;
        cmds.push(h.command);
        if (h.command.includes("goppi")) legacy++;
        const file = h.command.match(/\.claude\/hooks\/([\w.-]+)/)?.[1];
        if (file && !existsSync(join(root, ".claude", "hooks", file))) dangling++;
      }
    }
  }
  check("E4 훅 등록 위생(중복·유령·레거시 없음)", dup + dangling + legacy === 0,
    `중복 ${dup} · 파일 없는 등록 ${dangling} · 레거시 참조 ${legacy}`);
}

// ---------- F. SSOT 로스터 수량 일치 ----------
const roster = existsSync(join(root, "AGENTS.md")) ? readFileSync(join(root, "AGENTS.md"), "utf-8") : "";
const agentCount = existsSync(agentsDir) ? readdirSync(agentsDir).filter((f) => f.endsWith(".md")).length : 0;
const rosterRows = (roster.match(/\| .* \| .* \| \.claude\/agents\//g) ?? []).length;
check("F 로스터 행수 = 에이전트 파일수", rosterRows === agentCount, `로스터 ${rosterRows}행 vs 파일 ${agentCount}개`);

// ---------- 결과 ----------
console.log(`\n인수 테스트: 통과 ${pass} · 실패 ${fail}`);
process.exit(fail > 0 ? 1 : 0);
