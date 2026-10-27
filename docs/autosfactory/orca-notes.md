# Orca notes (Step 2, issue #16)

What I found by reading the code of the fork at `Documents\Github\orca`, based on upstream commit `48d8b35923`. I only read code and docs. I have not run Orca yet, so everything below says what the code does, not what I saw working.

## Rules Orca's own `AGENTS.md` sets for any change

- Reuse or extend existing code before writing a parallel version.
- Support macOS, Linux, and Windows, and think about remote use, mobile, and folder workspaces that are not git worktrees.
- Follow `docs/STYLEGUIDE.md` for UI. Do not name files `helpers`, `utils`, or `common`. Avoid comments and type assertions.
- Before handoff, run `pnpm check:changed --maxWorkers=2`. Run tests and agent-launched apps in the background with `ORCA_BACKGROUND_LAUNCH=1`.

## 1. The Jira integration

**Where:** `src/main/jira/` (client, search, issue read and mutation, credentials), `src/main/ipc/jira/` (request handlers), `src/shared/jira/` (types and the preset queries), `src/cli/` (a Jira command line), `mobile/src/tasks/` (mobile). User docs: `docs/site/content/docs/review/jira.mdx`.

**What it already does**
- Connects to Jira Cloud or self-hosted with an API token. Credentials are encrypted through the OS keychain. More than one site can be connected.
- Searches issues. `jira-issue-search.ts` accepts either a preset filter or a **raw JQL query** (`{ jql: string }`), so "assigned to me, in these statuses" can be expressed directly.
- Reads descriptions, comments, and attachments. Links an issue to a worktree and fills the workspace name from it.
- **Writes too:** edits fields, changes status through transitions, adds comments, and creates issues.

**What this means for the plan**
- Step 7 (Jira intake) is much smaller than planned: the connection, the keychain storage, and the search already exist. What is missing is a background job that runs our JQL every 30 minutes and creates our cards, plus the change alerts.
- Our "Jira is read-only" rule needs enforcing. Orca's integration can write, so the rule means we must not call the write functions from our code, and should switch off the write paths in the UI we reuse. A token with only `read:jira-work` and `read:jira-user` scopes would enforce it on Jira's side too.
- The remote runtime owns the token for SSH connections. Keep that in mind if we ever run remotely.

## 2. The agent dashboard (the kanban)

**Where:** `src/renderer/src/components/dashboard-popout/` (`AgentKanbanBoard.tsx`, `AgentKanbanCard.tsx`, filtering, toolbar), `src/shared/dashboard-snapshot.ts` (the card and bucket types), `src/main/ipc/dashboard-*.ts`, `src/preload/api/dashboard-*.ts`. It opens as a pop-out window.

**What it does**
- **Four columns**, called buckets: `attention` (shown as "Needs You"), `working`, `done`, `idle`. Each card is one agent pane, not one ticket.
- The bucket comes from the agent's reported status. Status values are `working`, `blocked`, `waiting`, `done` (`src/shared/agent-status-types.ts`).
- Status is reported by **native agent hooks, never read from terminal text.** Hook readers exist for Claude, Antigravity, Codex, Gemini, and many others (`src/shared/agent-hook-listener/providers/`).
- A card can open a terminal preview of its agent.

**What this means for the plan**
- Our eight ticket states are not agent statuses, so they cannot be derived from Orca's four buckets. Cards in Orca belong to agent panes. Ours belong to Jira tickets and outlive any one agent. That is a different data model, so Step 5 (the state store) is new code, and Step 6 builds a new board that reuses the card and column components. The existing board stays as it is.
- The agent status label on our cards can come straight from Orca's status stream.
- Orca's `done` for an agent is not our `done` for a ticket. We must keep them separate, as planned in ticket #1.

## 3. How agents are launched, and permissions

**Claude.** Orca has a structured chat mode that drives Claude through the **Claude Agent SDK**, the same driver we chose in ticket #3 (`src/main/claude/claude-structured-*`). Its permission modes are `ask`, `accept-edits`, `auto`, and `full-access` (`src/shared/agent-chat-permission-mode.ts`). Live permission prompts go through the SDK's `canUseTool` callback and a prompt registry (`claude-prompt-registry.ts`). A prompt carries the tool, its input, the matched ask rule, and the SDK's suggested permission updates.

**The skip-permissions default.** Orca adds `--dangerously-skip-permissions` through a setting called `agentDefaultArgs`. In a test, an empty `agentDefaultArgs` for Claude resolves to `full-access` (`src/shared/agent-chat-permission-host-support.test.ts`). So the unsafe default is a setting, and a safe default can be a change to that setting plus the default for new launches, not a rewrite of launching.

**Antigravity.** Orca does not use headless `agy -p`. It talks to Antigravity over **ACP (the Agent Client Protocol)** (`src/main/acp/`, `src/main/antigravity/`). ACP has a live `session/request_permission` request, and the Antigravity dialect handles it (`acp-dialects/antigravity-dialect.ts`). Questions from the agent are handled as well.

**What this means for the plan**
- Step 8 (safe launch): mostly a settings default plus our policy files feeding Orca's permission modes and ask rules. The three-button prompt for Claude has a real base to extend: the suggested permission updates already carry "allow for session" and "allow always" style choices (to be confirmed by running it).
- Step 12 and the Antigravity part of ticket #6: **corrected after research tickets #29 and #30.** Orca's ACP route has live approval, but it runs a separate Google server (not the `agy` CLI) and has **no Windows build at this commit** (the install throws "not available on win32 x64"). So on a Windows machine the fixed command list from ticket #6 stays the base. ACP is an upside only on macOS or Linux. Details: `docs/autosfactory/acp-research.md` in the fork.

## 4. Things Orca already has that Phases 2 and 3 need

- **Diff review:** `src/main/git/source-control/` (branch, file, and commit diffs) and `src/main/folder-workspace-diff-comments.ts`. Line comments on a diff can be sent back to the agent.
- **Pull requests:** `src/main/github/client/create/` creates PRs. Commit and push exist in the app.
- **Worktrees:** `src/main/git/worktree-create-preparation.ts`. Folder workspaces that are not worktrees also exist.
- **Usage tracking** for Claude, and account switching.

Steps 9 and 10 should start from these. The mandatory review gate (a ticket cannot become a PR without a review) is the part that does not exist.

## What this changes in the build plan

| Assumed in ticket #9 | What the code shows |
|---|---|
| Orca runs agents in terminals, so structured events and permission callbacks need extra work | Claude runs on the Agent SDK with live prompts. Antigravity runs over ACP with live prompts **on macOS and Linux only; no Windows build at this commit** (see `acp-research.md`). Events come from hooks. |
| The Jira support is a link drawer | It is a full client with search by raw JQL, keychain storage, and write support. |
| Skip-permissions is built into launching | It is a default in settings. |
| The agent dashboard could be extended into our board | Its cards are agent panes with four buckets. Our board needs its own ticket-based data. |

## Not checked yet

- Whether Orca builds and runs on your PC (Step 1 not confirmed), and whether the ACP route works with your Antigravity install.
- How a card is assigned its bucket, in detail, and how hard it is to add a ticket-based board beside the existing one.
- How the PR creation and diff comment flows are wired in the UI.
- Whether the "allow for session / for project" choices appear in the prompt as I expect.
