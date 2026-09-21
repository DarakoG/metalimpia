# Skill Registry

> **Project**: `clear_metadata`
> **Generated**: 2026-09-20 (refresh: added `brainstorming`)
> **Index policy**: index only — `SKILL.md` is the source of truth. Pass exact paths to subagents; do not generate compact rules from this file.

This file lists every agent skill available in this session. Subagents should receive exact `SKILL.md` paths matched from this table; never summarize or rewrite skill content.

## Sources scanned

| Scope   | Path                                                          | Skills found | Kept |
| ------- | ------------------------------------------------------------- | ------------ | ---- |
| project | `C:\NodeJS\Clear_Metadata\.agents\skills\` (added via `skills` CLI) | 1            | 1    |
| project | `C:\NodeJS\Clear_Metadata\.opencode\skills\`                  | 0            | 0    |
| user    | `C:\Users\DAEH\.agents\skills\`                               | 57           | 44 (1 superseded by project; +4 new installs) |
| opencode| `C:\Users\DAEH\.config\opencode\skills\`                      | 39           | 0 (all duplicates of user scope) |

## Deduplication rules applied

- **Same skill in multiple global locations** → kept the first source in scan order (`.agents\skills\` beats `.config\opencode\skills\`).
- **Skipped** per hard rule: `sdd-*` (11 skills) and `skill-registry` (1 skill).
- **Project-level wins over user-level**: `find-skills` now lives at `.\.agents\skills\find-skills\SKILL.md`, superseding the user-level copy.

## Skills

| Name | Trigger / description | Scope | Path |
| ---- | --------------------- | ----- | ---- |
| animation-vocabulary | Reverse-lookup glossary that turns a vague description of a web animation or motion effect into its exact term. Use when the user asks "what's it called when…" or describes a motion effect without knowing its name. | user | `C:\Users\DAEH\.agents\skills\animation-vocabulary\SKILL.md` |
| animate | Build an animation from scratch, making the decisions in the order that determines whether it feels right. Writes the implementation. Use when asked to animate something, add motion, make a component feel alive, or build a transition. | user | `C:\Users\DAEH\.agents\skills\animate\SKILL.md` |
| animate-expo | Build animations in React Native and Expo with Reanimated, Gesture Handler, Expo Router and expo-haptics. Use when animating anything in an Expo app, adding gestures, sheets, screen transitions, press feedback or haptics, or fixing motion that stutters on device. | user | `C:\Users\DAEH\.agents\skills\animate-expo\SKILL.md` |
| apple-design | Apple's approach to interface design and fluid, physical motion, translated for the web. Use when building or reviewing gesture-driven UI, spring animations, drag/swipe/sheet interactions, momentum and interruptible transitions, translucent materials and depth, typography, or reduced-motion. | user | `C:\Users\DAEH\.agents\skills\apple-design\SKILL.md` |
| ask-sonner | Guide to Sonner, the React toast library — install and wire up the Toaster, pick the right `toast()` call, promise and loading toasts, updating, dismissing and persisting toasts, styling, theming and icons, positioning and multiple toasters. Use when working with Sonner or troubleshooting it. | user | `C:\Users\DAEH\.agents\skills\ask-sonner\SKILL.md` |
| brainstorming | Mandatory before any creative work — feature creation, components, functionality, or behavior changes. Explores user intent, requirements, and design before implementation. Three paths: spike (feasibility question), bounded (small change in existing code), architectural (new project or restructure). | user | `C:\Users\DAEH\.agents\skills\brainstorming\SKILL.md` |
| branch-pr | Create Gentle AI pull requests with issue-first checks. Trigger: creating, opening, or preparing PRs for review. | user | `C:\Users\DAEH\.agents\skills\branch-pr\SKILL.md` |
| chained-pr | Trigger: PRs over 400 lines, stacked PRs, review slices. Split oversized changes into chained PRs that protect review focus. | user | `C:\Users\DAEH\.agents\skills\chained-pr\SKILL.md` |
| cognitive-doc-design | Design docs that reduce cognitive load. Trigger: writing guides, READMEs, RFCs, onboarding, architecture, or review-facing docs. | user | `C:\Users\DAEH\.agents\skills\cognitive-doc-design\SKILL.md` |
| create-ideas | Generate ideas in one shot using creative sampling. | user | `C:\Users\DAEH\.agents\skills\create-ideas\SKILL.md` |
| comment-writer | Write warm, direct collaboration comments. Trigger: PR feedback, issue replies, reviews, Slack messages, or GitHub comments. | user | `C:\Users\DAEH\.agents\skills\comment-writer\SKILL.md` |
| computer-use | Use Orca's computer-use CLI to inspect and operate local desktop app windows through accessibility trees, screenshots, and safe UI actions. Use for desktop app interaction: list apps/windows, get app state, read visible UI, click controls, type, press keys, scroll, drag, set values, or perform accessibility actions. | user | `C:\Users\DAEH\.agents\skills\computer-use\SKILL.md` |
| emil-design-eng | Encodes Emil Kowalski's philosophy on UI polish, component design, animation decisions, and the invisible details that make software feel great. | user | `C:\Users\DAEH\.agents\skills\emil-design-eng\SKILL.md` |
| evaluating-startup-ideas | Help users distinguish between deceptive tarpit ideas and high-potential opportunities by applying rigorous frameworks for market timing, business math, and user demand. | user | `C:\Users\DAEH\.agents\skills\evaluating-startup-ideas\SKILL.md` |
| find-animation-opportunities | Search a codebase or UI for places that don't animate but should, and reject everything that shouldn't. Read-only; proposes motion with exact values. Use when the user asks "what could be animated here?" or wants to "make this feel more alive". | user | `C:\Users\DAEH\.agents\skills\find-animation-opportunities\SKILL.md` |
| find-skills | Helps users discover and install agent skills when they ask "how do I do X", "find a skill for X", or express interest in extending capabilities. | project | `C:\NodeJS\Clear_Metadata\.agents\skills\find-skills\SKILL.md` |
| gentle-ai-bench | Trigger: bench, journey, journeys, driven mode, gentle-ai-bench, journey corpus, j-numbers, bench axis. Author and verify gentle-ai bench journeys; `go test ./bench` never proves driven execution. | user | `C:\Users\DAEH\.agents\skills\gentle-ai-bench\SKILL.md` |
| go-testing | Trigger: Go tests, `go test` coverage, Bubbletea `teatest`, golden files. Apply focused Go testing patterns. | user | `C:\Users\DAEH\.agents\skills\go-testing\SKILL.md` |
| hyperframes | Mandatory entry point for any request to make, create, edit, animate, or render a video, animation, or motion graphic. Resumes project state, captures intent, selects and installs the owning workflow, routes domain capabilities. | user | `C:\Users\DAEH\.agents\skills\hyperframes\SKILL.md` |
| hyperframes-animation | All animation knowledge for HyperFrames — atomic motion rules, multi-phase scene blueprints, scene transitions, runtime adapters (GSAP default, Lottie, Three.js, Anime.js, CSS keyframes, WAAPI, TypeGPU). Use for any motion/animation task in HyperFrames. | user | `C:\Users\DAEH\.agents\skills\hyperframes-animation\SKILL.md` |
| hyperframes-cli | Use the HyperFrames CLI development loop: init, add, catalog, capture, lint, check, snapshot, compare, preview, play, render, publish, cloud, doctor, etc. Covers local, HeyGen-hosted cloud, AWS Lambda, and Google Cloud Run rendering. | user | `C:\Users\DAEH\.agents\skills\hyperframes-cli\SKILL.md` |
| hyperframes-core | The HyperFrames composition contract — composition structure, `data-*` timing attributes, `class="clip"`, tracks, sub-compositions, variables, framework-owned media playback, deterministic-render rules, validation. Read before writing composition HTML. | user | `C:\Users\DAEH\.agents\skills\hyperframes-core\SKILL.md` |
| hyperframes-creative | Non-animation creative direction for HyperFrames videos. Use for design spec handling, palettes, typography, narration, beat planning, audio-reactive visuals, composition patterns, brand/style decisions. | user | `C:\Users\DAEH\.agents\skills\hyperframes-creative\SKILL.md` |
| hyperframes-keyframes | Use when a HyperFrames composition needs seek-safe 2D/3D keyframes, GSAP timelines, CSS keyframes, Anime.js, WAAPI, FLIP, paths, masks, SVG morph/draw, text trails, 3D depth, or `hyperframes keyframes` diagnostics. | user | `C:\Users\DAEH\.agents\skills\hyperframes-keyframes\SKILL.md` |
| hyperframes-registry | Install, discover, and wire registry blocks and components into HyperFrames compositions. Use when running `hyperframes add` or `hyperframes catalog`, wiring an installed item into index.html, or working with hyperframes.json. | user | `C:\Users\DAEH\.agents\skills\hyperframes-registry\SKILL.md` |
| idea-generation | Generate novel research ideas with iterative refinement and novelty checking against literature. Score ideas on Interestingness, Feasibility, and Novelty. Use when brainstorming research directions or validating idea novelty. | user | `C:\Users\DAEH\.agents\skills\idea-generation\SKILL.md` |
| impeccable | Use when the user wants to design, redesign, shape, critique, audit, polish, clarify, distill, harden, optimize, adapt, animate, colorize, extract, or otherwise improve a frontend interface. Covers UX, visual hierarchy, accessibility, performance, responsive behavior, theming, anti-patterns, typography, spacing, layout, color, motion, micro-interactions, UX copy, error states, edge cases, i18n, and reusable design systems. | user | `C:\Users\DAEH\.agents\skills\impeccable\SKILL.md` |
| improve-animations | Survey a codebase's animation and motion code, then produce a prioritized audit and self-contained implementation plans for other agents to execute. Read-only on source code — plans improvements, does not apply them. | user | `C:\Users\DAEH\.agents\skills\improve-animations\SKILL.md` |
| issue-creation | Trigger: issue creation, bug reports, feature requests, or issue approval. Create and triage GitHub issues from repository evidence. | user | `C:\Users\DAEH\.agents\skills\issue-creation\SKILL.md` |
| judgment-day | Trigger: judgment day, dual review, adversarial review, juzgar. Run explicit blind dual review with at most two scoped fix/re-judgment rounds. | user | `C:\Users\DAEH\.agents\skills\judgment-day\SKILL.md` |
| media-use | Agent Media OS for HyperFrames: resolve BGM, SFX, image, icon, brand logo, voice, color grade, or LUT into a frozen local file or paste-ready block + ledger record; generate via TTS / music / image models; produce voiceover, transcription, captions, and background removal. | user | `C:\Users\DAEH\.agents\skills\media-use\SKILL.md` |
| orca-cli | Use the public `orca` CLI to operate Orca-managed worktrees, folder contexts, terminals, repos, automations, artifacts, skill sharing, worktree comments, and the browser embedded inside the Orca app. | user | `C:\Users\DAEH\.agents\skills\orca-cli\SKILL.md` |
| orchestration | Use Orca orchestration for structured multi-agent coordination: threaded messages, blocking ask/reply flows, task dispatch, worker_done/escalation waits, task DAGs, decision gates, coordinator loops, or decomposing work across agents. | user | `C:\Users\DAEH\.agents\skills\orchestration\SKILL.md` |
| pick-ui-library | Pick the right library for a given frontend task from a curated, opinionated list — numbers, OTP inputs, charts, command menus, virtualization, drag and drop, toasts, state, styling, and more. Only runs when explicitly invoked. | user | `C:\Users\DAEH\.agents\skills\pick-ui-library\SKILL.md` |
| playwright-cli | Automate browser interactions, test web pages and work with Playwright tests. | user | `C:\Users\DAEH\.agents\skills\playwright-cli\SKILL.md` |
| prototype | Build multiple genuinely different versions of a UI piece you describe, rendered behind a visual picker so you can flip through them live and promote the one that feels right. Only runs when explicitly invoked. | user | `C:\Users\DAEH\.agents\skills\prototype\SKILL.md` |
| rdd-defect-workflow | Trigger: RDD, receipt-driven development, review authority, receipt/lineage, correction/recovery, delivery gate/kill switch, bounded review defects. Guide work. | user | `C:\Users\DAEH\.agents\skills\rdd-defect-workflow\SKILL.md` |
| review-animations | Reviews animation and motion code against a high craft bar derived from Emil Kowalski's design engineering philosophy. Default to flagging; approval is earned. | user | `C:\Users\DAEH\.agents\skills\review-animations\SKILL.md` |
| skill-creator | Trigger: new skills, agent instructions, documenting AI usage patterns. Create LLM-first skills with valid frontmatter. | user | `C:\Users\DAEH\.agents\skills\skill-creator\SKILL.md` |
| skill-improver | Trigger: improve skills, audit skills, refactor skills, skill quality. Audit and upgrade existing LLM-first skills. | user | `C:\Users\DAEH\.agents\skills\skill-improver\SKILL.md` |
| supabase | Core Supabase CLI, migrations, RLS, Edge Functions. When working with Supabase — database, auth, storage, or edge functions. | user | `C:\Users\DAEH\.agents\skills\supabase\SKILL.md` |
| systemic-issue-triage | Trigger: new issue, bug report, triage, backlog, issue flood, community report, root cause, dead-end, blocked user. Attack issues by root class, never one-by-one; fixes must shrink the system, not grow it. | user | `C:\Users\DAEH\.agents\skills\systemic-issue-triage\SKILL.md` |
| vercel-deployment | Expert knowledge for deploying to Vercel with Next.js. | user | `C:\Users\DAEH\.agents\skills\vercel-deployment\SKILL.md` |
| work-unit-commits | Plan commits as reviewable work units. Trigger: implementation, commit splitting, chained PRs, or keeping tests and docs with code. | user | `C:\Users\DAEH\.agents\skills\work-unit-commits\SKILL.md` |
| write-swift | How to write modern Swift well — value types, Swift 6 data-race safety and approachable concurrency, protocols and generics, API design, performance and ARC, Swift Testing, macros. Use when writing, reviewing, or migrating Swift, or when a concurrency error, hang, data race, retain cycle, or performance problem needs fixing. | user | `C:\Users\DAEH\.agents\skills\write-swift\SKILL.md` |

## Skipped (per skill-registry rules)

- `sdd-*` (11): `sdd-apply`, `sdd-archive`, `sdd-design`, `sdd-explore`, `sdd-init`, `sdd-onboard`, `sdd-propose`, `sdd-research`, `sdd-spec`, `sdd-tasks`, `sdd-verify` — managed by the SDD system prompt, not indexed here.
- `skill-registry` — the registry itself; never indexes itself.

## Delegator usage

When launching a subagent that touches skill-relevant file paths or matches a trigger above:

1. Find the matching skill name in the table.
2. Copy its `SKILL.md` path verbatim into the subagent prompt under `## Skills to load before work`.
3. Instruct the subagent to read that exact file BEFORE task-specific work.

Do not generate compact skill rules from this file. The subagent reads the real `SKILL.md`.
