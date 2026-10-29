# Permission prompt design (issue #22, step 8)

The three-button prompt UI is not built yet. This note says how the buttons work on each surface, which route to pick for Claude agents inside the sandbox, and what was verified on 2026-10-29 in the disposable distro `af-test` (Claude Code 2.1.312) and with Antigravity `agy` on Windows.

The non-UI core is in `src/shared/autosfactory/permission-*.ts`, `safe-launch.ts` and `src/main/autosfactory/policy/`.

## The three buttons and the rule each one writes

| Button | What it does | Rule |
| --- | --- | --- |
| Allow once | this one call | none |
| Allow for this session | this ticket's run only | an in-memory rule held by the board, never written to a file |
| Make permanent (link after once/session) | shows the exact rule first, then saves it | `Bash(<exact command>)` in that repo's policy file; refused when a deny rule matches, when it is broader than the exact command, or when the repo is not the ticket's repo (`planPromotion`) |

## Surfaces

| Surface | Once | Session | Permanent | Notes |
| --- | --- | --- | --- | --- |
| Claude Code terminal CLI (what Orca's terminal tab runs) | option 1 | no such option: option 3 switches the whole session to auto mode | option 2 is `don't ask again for curl *`, a broad wildcard | the board cannot add buttons to this prompt and cannot see the choice; our own narrow rule must come from our UI |
| Claude Agent SDK `canUseTool` (Orca's structured chat) | `allow` | `allowForSession`, but it forwards all SDK suggestions including a `localSettings` rule, so it may persist (not verified) | our own write via `planPromotion` | the host gets the exact tool input, so the exact rule can be computed and the three buttons fit |
| Antigravity interactive | option 1 | option 2 (this conversation) | option 3 writes an exact-command rule to `~\.gemini\antigravity-cli\settings.json` | already close to our buttons; its exact-command rule matches our narrowest-rule idea |
| Headless files | not possible | not possible | allow rules in a file before the run | Claude `-p` denies anything not allowed (ask rules cannot prompt); Antigravity headless auto-denies any shell command without an exact `command(...)` rule |

## What was verified

All in `af-test`, as the `user` account (signed in) with a root-owned `/etc/claude-code/managed-settings.json` and a root-owned `--settings` file, in empty temp folders.

- The managed path `/etc/claude-code/managed-settings.json` is read by Claude Code 2.1.312. Keys `permissions.allow|ask|deny`, `permissions.defaultMode` and `permissions.disableBypassPermissionsMode` are accepted. Rule strings use the same syntax as our files: `Bash(git status)`, `Bash(rm -rf *)`, `Read(**/.env)`, `Edit(./**)`.
- Headless `claude -p --permission-mode default`: an allowed command ran, an unlisted command and a `curl` (ask) were denied, `Read .env` was denied, `rm -rf` (deny) was denied, an edit inside the working folder succeeded, a write outside it was denied.
- `--dangerously-skip-permissions` combined with the policy files: `rm -rf` was still denied.
- The ticket user (`tkt1`) could not append to, delete or move the managed file or its folder (all permission denied; file is `root 644`).
- `--permission-mode default` is accepted although `claude --help` lists `manual`.
- An ask rule beats an allow rule in Claude Code. A bare `Bash` ask therefore hides every exact `Bash(...)` allow (seen: `echo hello` was denied until the bare ask was removed). The translator drops a bare `Bash` ask and any ask pattern that matches an exact allow; manual mode asks for unlisted commands anyway.
- Antigravity: `agy --settings <file>` with `{"permissions":{"allow":["command(echo af-settings-test)"]}}` made that command run headless; the same prompt without `--settings` was auto-denied. The setting is "for this session only, never saved" and the file can sit outside the ticket user's reach, so the Antigravity allow list is passed per launch instead of being written into the user's own settings.json. Not tested inside `af-test` (agy is not installed there).
- A ticket user cannot run Claude: `claude -p` as `tkt1` answers "Not logged in". See the sign-in problem below.

## Route for Claude agents inside the sandbox

Recommendation: the Claude Code CLI in headless/stream mode with the root-owned policy files for the first release (phase 1), then the SDK `canUseTool` route for live three-button prompts (phase 2).

| | Terminal CLI interactive | CLI headless with policy files | SDK `canUseTool` |
| --- | --- | --- | --- |
| Three buttons | no (wrong choices, broad wildcard) | no live prompt: ask = denied, ticket stops and asks | yes, full control, exact rule computed by us |
| Agent cannot edit policy | yes with managed file | yes | yes if the SDK process runs as the ticket user with the same managed file |
| Works with Orca today | yes (it is the terminal tab) | needs the future launcher | Orca has the SDK route in code, but it runs in Orca's process, not as the ticket Linux user |
| Cost | none | small | the SDK host would have to run inside the sandbox as the ticket user, which Orca does not do today |

Trade-offs: the SDK route gives the exact three-button flow but needs a small Node process inside the distro running as the ticket user (talking to Orca over stdio through `wsl.exe`). The CLI-with-files route is available now and safe, but an `ask` result stops the run instead of prompting; the user answers on the board, the board promotes or runs a session rule, and the ticket restarts with a new policy file. Do the CLI-with-files route first because it already enforces everything.

## Sign-in problem for per-ticket Linux users

Each ticket user has an empty home, so no agent credentials. Options, none copying Windows secrets:

1. One shared credential area readable only through a root-owned wrapper: rejected, it lets one ticket read another's token.
2. Per-ticket sign-in with the device-code or browser flow, once per ticket: safe, annoying; the user approves in a browser each time.
3. An API key or token held by Orca and passed into the ticket user's process environment at launch (`ANTHROPIC_API_KEY`, or Claude's `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`): one secret, passed per run, not stored in the home. The agent can read its own environment, and the firewall only blocks the host, so a leaked token can be abused; scope it to a dedicated key with a spend limit.
4. A long-lived signed-in helper user whose credentials are copied into each ticket home at start and wiped at destroy: only for the Linux copy of the token, never the Windows one.

Recommended: option 3 with a dedicated, limited key or setup-token that Kareem creates for tickets. Not tested here (needs Kareem's account).

## Safe launch and Orca's default

Orca's default is `agentPermissionDefault: 'full-access'` in `src/shared/default-global-settings.ts`, which resolves to `--dangerously-skip-permissions` for Claude and Antigravity (`YOLO_TUI_AGENT_ARGS` in `src/shared/tui-agent-permissions.ts`). A stored profile keeps its value, so changing the default affects only fresh installs. Our own launches do not read it: `buildClaudeLaunchArgs` and `buildAntigravityLaunchArgs` build their arguments themselves and refuse the skip flags. Changing Orca's own default for every workspace is left as a decision (see the report).

## Open points

- Antigravity wildcard allow rules (`command(npm test *)`) were not tested, so only exact commands are translated; wildcard allow rules are skipped and listed.
- Antigravity inside the sandbox: `--settings` points at a root-owned file, but the ticket user's own `~/.gemini/antigravity-cli/settings.json` is still writable by the agent and merges with it (not tested whether it can widen the allow list there). Use only exact rules and do not rely on Antigravity for deny.
- Chained commands, redirects and `$(...)` are never auto-allowed by our resolver, and cannot be promoted.
