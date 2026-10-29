# Permission prompts (research ticket #30)

Based on upstream commit `48d8b35923`. Every claim is marked **[code]** (read in source), **[fixture]** (seen in a recorded real session file), **[test]** (pinned by a test file), or **[not checked]**. Nothing here was seen running: Orca has not been built on this machine yet.

## 1. Claude (Agent SDK route)

### What a prompt carries [code]

`src/main/claude/claude-prompt-registry.ts`, `claude-permission-presentation.ts`

| Field                                 | Meaning                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `toolName`, `toolUseId`, `input`      | The tool and what it wants to do                                                                        |
| `kind`                                | `approval`, or `question` (the `AskUserQuestion` tool)                                                  |
| `title`, `displayName`, `description` | Text for the card (control characters stripped)                                                         |
| `decisionReason`                      | Why the SDK is asking                                                                                   |
| `blockedPath`                         | The path that triggered the prompt                                                                      |
| `matchedAskRule`                      | `{ source, toolName, ruleContent? }`: the ask rule that matched, and which settings source it came from |
| `suggestions`                         | The SDK's suggested permission updates (see below)                                                      |
| `subject`                             | For `ExitPlanMode` only: the plan text and file path                                                    |
| `agentId`                             | Set when a subagent asked                                                                               |

### What a real suggestion list looks like [fixture]

`src/main/claude/__fixtures__/claude-subagent-permission-frames.json`, a recorded `can_use_tool` request for `Bash: touch c9-probe-fg.txt`:

1. `addRules`: allow `Bash` with `ruleContent` equal to that exact command, `destination: "localSettings"`
2. `addDirectories`: the working directory, `destination: "session"`
3. `setMode`: `acceptEdits`, `destination: "session"`

So the SDK already proposes a **narrowest-possible rule** (the exact command), the same idea as our "make permanent" rule.

### The answers [code]

`src/main/claude/claude-structured-prompt-replies.ts`: `allow`, `allowForSession`, `deny`, `cancel`.

| Answer            | What is sent to the SDK                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `allow`           | `behavior: allow`, no permission updates                                                                                        |
| `allowForSession` | `behavior: allow` plus `updatedPermissions` = **all** suggestions (not for plan prompts)                                        |
| `deny`            | `behavior: deny`, "User denied this action."                                                                                    |
| `cancel`          | A dismissal: a deny that tells Claude to wait; an approval can be dismissed without stopping the session, a question needs Stop |

Malformed requests are denied automatically (`denySafeResult`).

### The catch in "allow for session" [code + fixture, inference]

Because `allowForSession` sends back every suggestion, it would also send the `addRules` entry whose destination is `localSettings`. If the SDK writes that to the project's local settings file (my understanding, **[not checked]**), then Orca's "session" answer **saves the narrow rule beyond the session**, on that machine and project. That is closer to our "whole project" than to "this session". Needs a real run to confirm.

### Permission modes [code]

`src/shared/agent-chat-permission-mode.ts`, `claude-structured-launch-resolution.ts`

| Orca mode      | Claude SDK setting                        |
| -------------- | ----------------------------------------- |
| `ask`          | `default`                                 |
| `accept-edits` | `acceptEdits`                             |
| `auto`         | `auto`                                    |
| `full-access`  | the `--dangerously-skip-permissions` flag |

- A saved choice that an agent does not offer falls back to `ask`, "never grants more access" [code].
- A test pins that with no `agentDefaultArgs` setting, a legacy host maps Claude to `full-access`, and with an empty string to `ask` [test: `agent-chat-permission-host-support.test.ts`]. Whether a fresh install's UI defaults to full access is **[not checked]**.
- Orca asks the SDK to read Claude's normal settings files (`settingSources: CLAUDE_DEFAULT_SETTING_SOURCES`) [code]. So our allow/ask/deny policy could be written as Claude permission rules in those files. How Orca decides which sources are included is **[not checked]**.

### Questions [code]

`kind: question` prompts carry `questionIds` and are answered with answers, not a decision. Sending a decision to a question (or the reverse) throws.

## 2. Antigravity (ACP route)

See `acp-research.md`. Short version: the prompt shape is the protocol's, not Orca's, and **it is not available on Windows at this commit**.

- Options come from the server: Orca builds the UI options from `request.options` (id, name) and replies with the chosen `optionId` [code: `acp-timeline-requests.ts`].
- The protocol defines four option kinds: `allow_once`, `allow_always`, `reject_once`, `reject_always` [code: generated schema].
- The only recorded Antigravity prompt is a **question** (tool call id starting `interaction_`) with two options, both `allow_once` [fixture: `antigravity-v1-question.jsonl`]. **No recorded tool-permission request from Antigravity exists**, so which options it offers for tools is **[not checked]**.
- Questions are never auto-approved, even in the most permissive mode [code: `antigravity-dialect.ts`]. During a stop or steering, any request is answered `cancelled` [code: `acp-structured-acquire.ts`].
- Modes: `ask` -> `default`, `accept-edits` -> `auto_edit`, `full-access` -> `yolo`. There is **no `auto` mode** for Antigravity [code: `acp-launch-specs.ts`].

## 3. Our three buttons against what exists

| Our button                  | Claude                                                                                                              | Antigravity (ACP)                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Allow once                  | `allow`: exists                                                                                                     | `allow_once` option: exists in protocol                                                |
| Allow for this session      | `allowForSession`: exists, but it also forwards the `localSettings` rule (see above), so it may not be session-only | no session-scoped answer known; `allow_always` is the closest and is **[not checked]** |
| Allow for the whole project | no separate answer; a suggestion with `localSettings`/project destination is the closest                            | `allow_always` at best, scope **[not checked]**                                        |
| Make permanent (our link)   | not present: needs our own policy file write                                                                        | not present                                                                            |
| Deny                        | `deny`: exists                                                                                                      | `reject_once` option: exists in protocol                                               |

**Gaps to close in #22:** (1) a session-only answer that filters the suggestions by destination `session`; (2) a project-scope answer that writes our own per-repo policy file instead of relying on `localSettings`; (3) the make-permanent link and its "never past the deny list" rule; (4) Antigravity on Windows (see `acp-research.md`).

## 4. Not checked yet

- Q6: where the prompt card is rendered in the UI and where a "needs permission" card flag would plug in.
- Q7: how a pending prompt maps to the agent status values (`blocked`/`waiting`) that our card flag and the "waiting on you" state depend on.
- A real run: approve one prompt, deny one, and see what gets written where.

## Seen working (Kareem's screenshots, 2026-10-29)

Orca's terminal mode runs the Claude Code CLI (v2.1.312). This is a different surface from the Agent SDK route read in code above.

- **Default launch is bypass.** A new workspace starts Claude Code with "bypass permissions on". In that mode a file write (`Write(test.txt)`) and a network call (`curl https://example.com`) ran with no prompt, and `ls ~` listed the whole Windows home folder. A command typed with a leading `!` runs in the shell outside Claude's permission system in every mode.
- **The CLI's modes** (Shift+Tab): Manual (asks), Accept edits on, Auto mode on (a safety check decides, with no prompt for each action), Plan mode on. A session that was started with bypass cannot be made to ask for most edits or commands by switching to plan mode: the CLI said so itself.
- **A real prompt for a shell command** (`curl https://example.com`):
  - Header "Bash command", a description, and the exact command, then "This command requires approval. Do you want to proceed?"
  - 1. Yes. 2. Yes, and don't ask again for: `curl *`. 3. Yes, and switch to auto mode. 4. No. Footer: "Esc to cancel, Tab to amend".
- **Where Orca shows "waiting for permission":** the workspace card in the sidebar turns orange and shows "Bash: curl..." with a time; the terminal tab shows an orange icon; the Projects bell shows a count. This answers Q6 (where a card flag plugs in): Orca already has a "needs attention" state on workspace cards, driven by the agent's status, so our "waiting on you" flag can reuse it. Q7 (mapping a pending prompt to `waiting` or `blocked`) is not decided: the visible state is the orange attention state; which of the two status values it is was not checked.

### What this means for our three buttons (#22)

| Our button                  | The CLI prompt offers                                                 | Gap                                                                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allow once                  | 1. Yes                                                                | none                                                                                                                                                                                   |
| Allow for this session      | not offered as such; option 3 switches the whole session to auto mode | needs our own answer                                                                                                                                                                   |
| Allow for the whole project | option 2, "don't ask again for `curl *`"                              | the rule is a wildcard: it would allow any `curl` command, including one that sends data to any address. Our rule must be the narrowest possible (the exact command), as planned in #6 |
| Make permanent link         | not offered                                                           | needs our own policy file                                                                                                                                                              |
| Deny                        | 4. No                                                                 | none                                                                                                                                                                                   |

Not captured yet: the prompt for a file edit, Accept edits mode, and the prompt in Auto mode.

## Antigravity interactive prompt, mapped to our three buttons (seen on screen, 2026-10-29)

| Our button                  | Antigravity CLI (interactive)                                                                     | Gap                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Allow once                  | 1. Yes, run command                                                                               | none                                                                                              |
| Allow for this session      | 2. Yes, and always allow in this conversation for commands that start with the exact command text | none (scope is the conversation)                                                                  |
| Allow for the whole project | 3. Yes, and always allow ... (Persist to settings.json)                                           | the rule goes to the user-level `~\.gemini\antigravity-cli\settings.json`, not a per-project file |
| Make permanent link         | option 3                                                                                          | same as above; our own policy file would still be the source of truth                             |
| Deny                        | 4. No, cancel                                                                                     | none                                                                                              |

Antigravity's rule is the exact command text, narrower than Claude Code's `curl *`. Details of the headless behaviour are in `acp-research.md`.
