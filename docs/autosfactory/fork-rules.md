# Fork rules (step 3, issue #17)

How we add the Autosfactory features to this fork of Orca without making Orca's updates painful to pull in. Written against upstream `80c9278b89` (2026-10-27). Claims marked **[measured]** come from commands run on the fork; everything else is a decision.

## Why these rules are strict

**[measured]** On 2026-10-27 the fork (at `48d8b35923`, 2026-10-25) was 0 commits ahead and **528 commits behind** upstream. Upstream made **3,020 commits in the 14 days** from 2026-10-13, about 200 a day. The two-day gap changed 20,689 files, mostly small edits (Orca is trimming comments across the whole code base, which is why almost every file moves). 120 of those files are in the exact areas we study: the Jira client, the agent dashboard, and Claude launching.

Any edit we make to an Orca file will be competing with that rate. New files in new folders will not.

## 1. Where our code lives

Everything new goes in folders we own. Names follow Orca's own rule (`AGENTS.md`): the concrete concept, never `helpers`, `utils`, or `common`.

| Part                                                                                    | Folder                                                                                                                     |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Main process: ticket state store, Jira sync job, permission policy files, review gate   | `src/main/autosfactory/`                                                                                                   |
| Types shared by main and renderer: ticket states, agent status label, policy file shape | `src/shared/autosfactory/`                                                                                                 |
| Board UI: columns, cards, side panel                                                    | `src/renderer/src/components/autosfactory/`                                                                                |
| Preload bridge                                                                          | `src/preload/api/autosfactory-bridge.ts` and `autosfactory-api.ts` (same pattern as the dashboard's `dashboard-bridge.ts`) |
| Our docs and notes                                                                      | `docs/autosfactory/`                                                                                                       |
| Tests                                                                                   | next to the file they test, as in Orca (`*.test.ts`)                                                                       |

## 2. Touching Orca's own files: seams only

A **seam** is a place where an Orca file has to change so our code can plug in. Rules:

- A seam is a one-line import and a one-line call, or a one-line entry in a list. Nothing more.
- No reformatting, renaming, moving, or "while I'm here" fixes in Orca's files. Those are what create conflicts.
- If an Orca bug blocks us, make the smallest fix, and write it in the ledger below. Consider sending it upstream.
- Every seam is recorded in the ledger. Before each upstream merge, read the ledger first: it lists exactly where conflicts can appear.

### Seam ledger

| Seam                           | Orca file                                                                                                           | What we add                                                                                                                                                                                           | Added in     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Register our IPC handlers      | `src/main/ipc/register-core-handlers/register-core-handlers.ts` (next to `registerJiraHandlers()`, around line 197) | one import and one `registerTicketHandlers(...)` call                                                                                                                                                 | step 5 (#19) |
| Expose our API to the renderer | `src/preload/index.ts` (next to `dashboard: dashboardApi`, around line 145) and `src/preload/api-types.ts`          | one import and one entry in each (`autosfactory`)                                                                                                                                                     | step 5 (#19) |
| Show the board in the app      | `src/renderer/src/app-shell/AppRootSurfaces.tsx` (next to `<StarNagAgentValueMomentObserver />`)                    | one import and one `<AutosfactorySync />` line; the workspace board (Orca's sidebar drawer, unchanged) uses our eight ticket states as its columns and a workspace linked to a Jira issue is a ticket | step 6 (#20) |
| Unstarted tickets panel | `src/renderer/src/components/sidebar/WorkspaceKanbanDrawerView.tsx` (under `<WorkspaceKanbanDrawerHeader />`) | one import and one `<UnstartedTicketsPanel />` line; lists Jira tickets with no workspace yet, a project picker, Start, alerts, and the sync banner | step 7 (#21) |
| Jira changed badge on workspace cards | `src/renderer/src/components/sidebar/WorkspaceKanbanCard.tsx` (above `<WorktreeCard`) | one import and one `<JiraChangedBadge worktree={worktree} />` line; shows a badge while the linked Jira issue has open alerts | step 7 (#21) |
| Safer default launch           | the agent default arguments for Claude (`agentDefaultArgs` and the chat permission default)                         | to be recorded in step 8 (#22)                                                                                                                                                                        | not yet      |

Line numbers drift fast at this commit rate. Search for the neighbouring call, not the number.

## 3. Branches

- **`autosfactory`: our integration branch and the default branch** on GitHub (so "Closes #N" works). There is no `main` mirror: upstream is the `upstream` remote (`upstream/main`), and updates are merged into `autosfactory`.
- **`step-N-short-name`: one branch per step issue**, branched from `autosfactory`, merged back by pull request inside the fork. Never open pull requests to `stablyai/orca` by accident: check the "base repository" on the pull request page.

## 4. Pulling in Orca's updates

- Merge `upstream/main` into `autosfactory` (a merge, not a rebase, so our history is not rewritten): **at least once a week, and before starting any step that adds a seam.** One week is about 1,400 upstream commits at the measured rate. This cadence is a judgement, not measured, so lengthen or shorten it after the first few merges.
- After each merge run, in this order: `pnpm install`, `pnpm tc`, `pnpm test:changed --maxWorkers=2`, then start the app.
- Native parts: if `pnpm install` has to rebuild any (`node-pty`, the two `windows-*` addons, `windows-process-tree`), they need Visual Studio Build Tools with the C++ compiler component. This is installed on the PC now.
- The first test pull: `git fetch upstream main` **succeeded** on 2026-10-27, and with 0 commits ahead a merge is a clean fast-forward. It was not applied, to avoid changing files under a running app.

## 5. Rules our code inherits from Orca (`AGENTS.md`)

- Reuse or extend existing code before writing a parallel version (for example, the Jira client and keychain storage already exist).
- Cross-platform (macOS, Linux, Windows), remote use, mobile parity, and folder workspaces that are not git worktrees: every change considers all four.
- UI follows `docs/STYLEGUIDE.md` and the tokens in `src/renderer/src/assets/main.css`.
- Avoid comments; one line, why not how. Avoid type assertions except `as const`.
- Run `pnpm check:changed --maxWorkers=2` before handing work off. Orca's ratchet checks (line counts, imports, and similar) apply to our files too.
- Run tests and agent-launched apps in the background (`ORCA_BACKGROUND_LAUNCH=1`) as `AGENTS.md` says.

## 6. Other rules

- **Jira is read-only.** Use a token with only `read:jira-work` and `read:jira-user`. Orca's Jira client can write, so our code must not call its write functions, and the paths we reuse must have writing switched off.
- **No secrets in the repo.** Tokens live in the OS keychain.
- **Identity:** commits may carry the Claude co-author line; the author need not be Kareem.
- **License:** Orca is MIT. Keep `LICENSE` and the copyright notice. A fork of a public repository stays public.

## 7. Open questions

- **Telemetry (decided: off, see #32):** Orca collects anonymous usage data (see its privacy and telemetry docs). Decide whether to turn it off in our build, since it runs next to company ticket data. Not checked what it sends. Update from step 3a: no code change or seam needed. Telemetry only transmits in CI-built releases (build-time write key), so our source builds cannot send; the installed released copy is turned off with the user environment variables `DO_NOT_TRACK=1` and `ORCA_TELEMETRY_DISABLED=1` plus the Settings toggle. Details and the outbound-host list: `docs/autosfactory/telemetry-and-outbound-data.md`. Packaging our own build would re-enable Orca updater against `stablyai/orca`: do not package without handling that.
- **Separate profile:** a released Orca is also installed on this PC. Whether the dev build shares its data folder with it is **not checked**. Orca has `pnpm dev:fresh` for a fresh profile.
- **Where the board appears in the renderer:** settled for now in step 6 (see the ledger); a proper sidebar entry is still open.
