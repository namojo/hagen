#!/usr/bin/env bun
/**
 * inject-governance.ts — 거버넌스 주입 (Phase 5)
 *
 * 판단이 아니라 설치다. 파일 복사, 치환, 훅 설치, git 설정은
 * LLM이 아니라 이 스크립트가 한다: 0.1초에 100% 정확하게.
 *
 * 사용법:
 *   bun scripts/inject-governance.ts --profile standard [--project .] [--name "프로젝트명"]
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync, readdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

type Profile = "light" | "standard" | "strict";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, "..", "skills", "harness", "references", "governance-assets");
const VERSION = "0.1.0";

// ---------- 인자 파싱 ----------
function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const profile = (arg("profile", "standard") as Profile);
const projectRoot = arg("project", ".")!;
const projectName = arg("name", "이 프로젝트")!;

if (!["light", "standard", "strict"].includes(profile)) {
  console.error(`✖ 알 수 없는 프로파일: ${profile} (light | standard | strict)`);
  process.exit(1);
}

// ---------- 설치 단계 정의 ----------
type Step = { name: string; run: () => void; profiles: Profile[] };
const ALL: Profile[] = ["light", "standard", "strict"];
const results: { name: string; ok: boolean; detail?: string }[] = [];

function render(template: string): string {
  return template
    .replaceAll("{{PROJECT_NAME}}", projectName)
    .replaceAll("{{PROFILE}}", profile)
    .replaceAll("{{RETRY_LIMIT}}", "2")
    .replaceAll("{{INSTALLED_AT}}", new Date().toISOString().slice(0, 10))
    .replaceAll("{{VERSION}}", VERSION);
}

const steps: Step[] = [
  {
    name: "_workspace 3구획 생성 (decisions / audit-log / memory)",
    profiles: ALL,
    run: () => {
      for (const d of ["decisions", "audit-log", "memory"]) {
        mkdirSync(join(projectRoot, "_workspace", d), { recursive: true });
      }
      const statusPath = join(projectRoot, "_workspace", "memory", "skill-status.json");
      if (!existsSync(statusPath)) writeFileSync(statusPath, JSON.stringify({ skills: {} }, null, 2));
    },
  },
  {
    name: "헌법 설치 (docs/constitution.md)",
    profiles: ALL,
    run: () => {
      mkdirSync(join(projectRoot, "docs"), { recursive: true });
      const tpl = readFileSync(join(ASSETS, "constitution.template.md"), "utf-8");
      writeFileSync(join(projectRoot, "docs", "constitution.md"), render(tpl));
    },
  },
  {
    name: "AGENTS.md 생성/갱신 (에이전트 정본 목록 — SSOT)",
    profiles: ALL,
    run: () => {
      const agentsDir = join(projectRoot, ".claude", "agents");
      const rows: string[] = [];
      if (existsSync(agentsDir)) {
        for (const f of readdirSync(agentsDir).filter((f: string) => f.endsWith(".md"))) {
          const body = readFileSync(join(agentsDir, f), "utf-8");
          const name = body.match(/^name:\s*["']?([^"'\n]+)/m)?.[1] ?? f.replace(".md", "");
          const desc = body.match(/^description:\s*["']?([^"'\n]+)/m)?.[1] ?? "";
          rows.push(`| ${name} | ${desc.slice(0, 80)} | .claude/agents/${f} |`);
        }
      }
      const table = rows.length
        ? `| 에이전트 | 역할 | 정의 파일 |\n|---|---|---|\n${rows.join("\n")}`
        : "_(아직 에이전트가 없다. Phase 3 완료 후 이 스크립트를 재실행하면 자동 갱신된다.)_";
      writeFileSync(
        join(projectRoot, "AGENTS.md"),
        `# 에이전트 정본 목록 (SSOT)\n\n이 파일이 이 프로젝트 에이전트의 유일한 정본 목록이다.\n` +
        `도구별 파일(CLAUDE.md 등)은 실행 방법만 담는다. 목록 갱신: \`bun scripts/inject-governance.ts\` 재실행.\n\n` +
        `${table}\n\n거버넌스: 프로파일 ${profile} · docs/constitution.md 참조\n`
      );
    },
  },
  {
    name: "세션 훅 설치 (시작·컴팩션 시 헌법 재주입)",
    profiles: ALL,
    run: () => {
      const hookDir = join(projectRoot, ".claude", "hooks");
      mkdirSync(hookDir, { recursive: true });
      const hook = readFileSync(join(ASSETS, "session-inject.sh"), "utf-8");
      const hookPath = join(hookDir, "hagen-session-inject.sh");
      writeFileSync(hookPath, hook);
      chmodSync(hookPath, 0o755);
      patchSettings(projectRoot, {
        SessionStart: [hookRef("hagen-session-inject.sh")],
        PreCompact: [hookRef("hagen-session-inject.sh")],
      });
    },
  },
  {
    name: "파괴적 명령 경고 훅 (careful)",
    profiles: ALL,
    run: () => installShellHook(projectRoot, "careful-guard.sh", "PreToolUse"),
  },
  {
    name: "증거 기반 태스크 종료 게이트",
    profiles: ["standard", "strict"],
    run: () => installShellHook(projectRoot, "evidence-gate.sh", "Stop"),
  },
  {
    name: "시크릿 스캔 훅",
    profiles: ["standard", "strict"],
    run: () => installShellHook(projectRoot, "secret-scan.sh", "PreToolUse"),
  },
  {
    name: "PR-only 강제 (pre-push 차단)",
    profiles: ["strict"],
    run: () => {
      const gitHooks = join(projectRoot, ".githooks");
      mkdirSync(gitHooks, { recursive: true });
      const prePush = readFileSync(join(ASSETS, "pre-push"), "utf-8");
      const p = join(gitHooks, "pre-push");
      const OWNERSHIP = ["hagen", "goppi"];
      if (existsSync(p) && !OWNERSHIP.some((m) => readFileSync(p, "utf-8").includes(m))) {
        // 남의 것은 지우지 않는다 — 백업 후 설치, 사용자에게 병합 판단을 넘긴다
        const backup = `${p}.backup-${Date.now()}`;
        writeFileSync(backup, readFileSync(p, "utf-8"));
        results.push({ name: "  └ 기존 사용자 pre-push 백업", ok: true, detail: backup });
      }
      writeFileSync(p, prePush);
      chmodSync(p, 0o755);
      // .git이 있으면 즉시 활성화 — 파일만 있고 hooksPath 미설정이면 게이트는 장식품이다
      if (existsSync(join(projectRoot, ".git"))) {
        let current = "";
        try { current = execSync("git config core.hooksPath", { cwd: projectRoot }).toString().trim(); } catch {}
        if (current && current !== ".githooks") {
          // 사용자의 기존 훅 체계(.husky 등)를 짓밟지 않는다 — 활성화는 사용자 판단
          results.push({ name: "  └ hooksPath 충돌 — 미변경", ok: true,
            detail: `기존 ${current} 유지. 활성화하려면 ${current}/pre-push에서 .githooks/pre-push 호출을 체이닝하라` });
        } else {
          execSync("git config core.hooksPath .githooks", { cwd: projectRoot });
          results.push({ name: "  └ core.hooksPath 활성화 완료", ok: true });
        }
      } else {
        results.push({ name: "  └ git 저장소 없음 — init 후 실행", ok: true, detail: "git config core.hooksPath .githooks" });
      }
    },
  },
];

// ---------- 헬퍼 ----------
function hookRef(file: string) {
  return { type: "command", command: `bash .claude/hooks/${file}` };
}

function installShellHook(root: string, file: string, event: string) {
  const hookDir = join(root, ".claude", "hooks");
  mkdirSync(hookDir, { recursive: true });
  const src = join(ASSETS, file);
  if (!existsSync(src)) throw new Error(`자산 없음: ${file}`);
  const dst = join(hookDir, file);
  writeFileSync(dst, readFileSync(src, "utf-8"));
  chmodSync(dst, 0o755);
  patchSettings(root, { [event]: [hookRef(file)] });
}


/** settings.json hooks에서 특정 훅 파일을 참조하는 항목 제거 (하겐 항목만 건드림) */
function removeFromSettings(root: string, filename: string) {
  const path = join(root, ".claude", "settings.json");
  if (!existsSync(path)) return;
  const cur = JSON.parse(readFileSync(path, "utf-8"));
  if (!cur.hooks) return;
  for (const event of Object.keys(cur.hooks)) {
    cur.hooks[event] = cur.hooks[event].filter(
      (entry: any) => !JSON.stringify(entry).includes(filename)
    );
    if (cur.hooks[event].length === 0) delete cur.hooks[event];
  }
  writeFileSync(path, JSON.stringify(cur, null, 2));
}

/** .claude/settings.json 의 hooks 항목에 병합 (기존 항목 보존, 중복 방지) */
function patchSettings(root: string, hooks: Record<string, object[]>) {
  const path = join(root, ".claude", "settings.json");
  mkdirSync(dirname(path), { recursive: true });
  const cur = existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : {};
  cur.hooks = cur.hooks ?? {};
  for (const [event, entries] of Object.entries(hooks)) {
    cur.hooks[event] = cur.hooks[event] ?? [];
    for (const e of entries) {
      const dup = JSON.stringify(cur.hooks[event]).includes(JSON.stringify((e as any).command ?? ""));
      if (!dup) cur.hooks[event].push({ hooks: [e] });
    }
  }
  writeFileSync(path, JSON.stringify(cur, null, 2));
}

// ---------- 실행 ----------
console.log(`\n하겐 거버넌스 주입 — 프로파일: ${profile}\n`);

for (const step of steps) {
  if (!step.profiles.includes(profile)) continue;
  try {
    step.run();
    results.push({ name: step.name, ok: true });
  } catch (e: any) {
    results.push({ name: step.name, ok: false, detail: e.message });
  }
}

// ---------- 수렴: 티어 초과 게이트 제거 (선언적) ----------
// 티어는 "허용 게이트 집합"을 선언한다. 설치는 부족분을 채우고, 이 단계가 초과분을 걷어낸다.
// 추가만 있고 제거가 없으면 티어 하향이 거짓말이 된다.
const TIER_HOOK_FILES: Record<Profile, string[]> = {
  light: ["hagen-session-inject.sh", "careful-guard.sh"],
  standard: ["hagen-session-inject.sh", "careful-guard.sh", "evidence-gate.sh", "secret-scan.sh"],
  strict: ["hagen-session-inject.sh", "careful-guard.sh", "evidence-gate.sh", "secret-scan.sh"],
};
try {
  const allowed = TIER_HOOK_FILES[profile];
  const allHagen = ["hagen-session-inject.sh", "careful-guard.sh", "evidence-gate.sh", "secret-scan.sh"];
  const LEGACY = ["goppi-session-inject.sh"]; // 구명칭 시절 설치물 — 방치하면 훅이 이중 발화한다
  const removedNames: string[] = [];
  for (const f of LEGACY) {
    const fp = join(projectRoot, ".claude", "hooks", f);
    if (existsSync(fp)) { rmSync(fp); removedNames.push(`${f}(레거시)`); }
    removeFromSettings(projectRoot, f);
  }
  for (const f of allHagen.filter((x) => !allowed.includes(x))) {
    const fp = join(projectRoot, ".claude", "hooks", f);
    if (existsSync(fp)) { rmSync(fp); removedNames.push(f); }
    removeFromSettings(projectRoot, f);
  }
  if (profile !== "strict") {
    const pp = join(projectRoot, ".githooks", "pre-push");
    // 소유권 판정: 현재 서명 + 과거 명칭 호환 (서명만 믿으면 리네이밍 시 고아 파일이 생긴다)
    const OWNERSHIP = ["hagen", "goppi"];
    if (existsSync(pp) && OWNERSHIP.some((m) => readFileSync(pp, "utf-8").includes(m))) {
      rmSync(pp);
      removedNames.push("pre-push");
      if (existsSync(join(projectRoot, ".git"))) {
        try { execSync("git config --unset core.hooksPath", { cwd: projectRoot }); } catch {}
      }
    }
  }
  if (removedNames.length)
    results.push({ name: `티어 초과 게이트 제거: ${removedNames.join(", ")}`, ok: true });
} catch (e: any) {
  results.push({ name: "티어 초과 게이트 제거", ok: false, detail: e.message });
}

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? "✔" : "✖"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  if (!r.ok) failed++;
}

if (failed > 0) {
  console.error(`\n✖ ${failed}개 단계 실패. 위 목록을 확인하고 수동 설치하거나 재실행하세요.`);
  process.exit(1);
}
console.log(`\n✔ 거버넌스 주입 완료 (${profile}). 다음 단계: bun scripts/validate.ts`);
