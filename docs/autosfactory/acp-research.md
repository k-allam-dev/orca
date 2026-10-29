# Antigravity's ACP route (research ticket #29)

Based on upstream commit `48d8b35923`. Claims are marked **[code]**, **[fixture]**, or **[not checked]**. Nothing was run: Orca has not been built on this machine.

## Short answer

1. **The ACP route does not use the `agy` CLI.** Orca downloads and runs a separate Google server, `agy_acp_server.par`, version 1.3.0.
2. **It is not available on Windows at this commit.** The pinned downloads cover macOS and Linux only. On Windows the install throws "Antigravity is not available on win32 x64."
3. Where it does run, it has live permission requests, session resume, and Google sign-in.

So the earlier hope (notes, step 2) that Orca's ACP route could give Antigravity live permission prompts **does not apply on a Windows PC**.

## 1. How Orca starts Antigravity [code]

`src/main/acp/acp-launch-specs.ts` (`ANTIGRAVITY_LAUNCH_SPEC`), `src/main/antigravity/antigravity-acp-runtime.ts`

- Command: `agy_acp_server.par` from a **managed runtime** that Orca downloads into its data directory (`agent-runtimes/antigravity`), version `1.3.0`, from `https://dl.google.com/agy-extensions/releases/...`.
- Each archive, the server, and its helper (`localharness_external`) are pinned by SHA-256 and byte size; the file notes "no upstream checksums are published", so Orca pins its own.
- `ignoreAgentCommandSetting: true`: a user-installed `agy` is never used. A code comment says "agy provides neither ACP nor its account."
- Linux root launches get `--uid=` so the server does not drop to `nobody`.
- Before accepting an install, Orca runs a probe in a throwaway home that checks the server's name (`antigravity-acp`), its version, protocol version 1, session load, session resume, and the Google login method [code: `antigravity-acp-runtime-probe.ts`].
- Download sizes (archive): about 111 MB (macOS arm64), 117 MB (macOS x64), 322 MB (Linux arm64), 334 MB (Linux x64). **No Windows entry.**

## 2. Platforms [code]

`PINNED` has `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`. `pin()` returns `null` for anything else, and the install then throws `Antigravity is not available on win32 x64.` (`managed-runtime-installation.ts`). The agent definition also reports the managed runtime as unsupported when the pin is `null` (`acp-structured-agent-definitions.ts`).

**Not checked:** whether Google publishes a Windows build at the same release location; whether Orca's WSL support (`src/wsl-guest`) could use the Linux build from inside WSL; what Orca shows the user for Antigravity on Windows (terminal mode with hook status exists: `src/shared/agent-hook-listener/providers/antigravity-events.ts`, not read).

## 3. What the server supports [fixture]

`src/main/acp/fixtures/antigravity-v1-question.jsonl` is a recorded `initialize` reply from `antigravity-acp` 1.3.0:

- Protocol version 1; `loadSession: true`; session `list` and `resume`; `auth.logout`.
- Prompts accept images, audio, and embedded context; MCP over HTTP and SSE.
- Sign-in methods advertised: `oauth-personal` (Google account), `oauth-business` (Gemini Enterprise), `gemini-api-key`, `agent-platform`. Orca picks `oauth-personal` when offered [code].

## 4. Questions from the ticket

| #   | Question                                                         | Answer                                                                                                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | How is it started and what does it need?                         | See section 1. It needs the managed download and a Google sign-in.                                                                                                                                                                                                          |
| 2   | Does it work with the Antigravity on this machine?               | **No on this PC (Windows):** no build is pinned. Orca does not use the installed `agy` in any case. **Not run.**                                                                                                                                                            |
| 3   | Which messages are supported?                                    | Permission requests (`session/request_permission`) and questions are handled; questions accept one offered choice and no free text [code: `antigravity-dialect.ts`]. Resume and cancel exist in the protocol and in Orca's handling. Usage/quota errors: **[not checked]**. |
| 4   | Can a stopped session resume?                                    | Yes by design: `resumePreference: 'resume'` because `session/load` replays the whole conversation, which the chat already holds [code]. Conversations are **separate from the `agy` CLI's**, which "cannot resume these sessions" [code comment].                           |
| 5   | Usage limit behaviour?                                           | **[not checked]**: needs a run, or a read of the error handling in `src/main/acp/`.                                                                                                                                                                                         |
| 6   | What is not supported versus headless `agy -p` and Claude's SDK? | Windows. A shared conversation store with `agy`. A model list before sign-in ("lists its models only in a signed-in session"). An `auto` permission mode.                                                                                                                   |

## 5. Other things worth knowing

- Orca **scrubs** `GEMINI_API_KEY`, `GOOGLE_*`, `AGY_ACP_*`, and a few cloud variables from the server's environment [code: `antigravity-acp-environment.ts`], so the API-key route we skipped in ticket #7 is not used here either.
- Modes: `ask` -> `default`, `accept-edits` -> `auto_edit`, `full-access` -> `yolo`; "yolo still requests questions and administrative reviews" [code].
- Private temp directory per session (`privateTempDirectory: true`).

## 6. Recommendation (for #22 and #26)

- **On Windows, do not plan on the ACP route.** Keep the fallback from planning ticket #6: Antigravity implements inside its worktree with a fixed pre-approved command list, and anything else stops and asks.
- **On macOS or Linux (or WSL, if it works), ACP is an upside**, not a base: it gives live permission requests and resume. Design #26 so the permission layer talks to a small interface, with ACP as one implementation and the fixed list as the other.
- The decision for #22/#26 depends on one fact still open: what your target machine is. If the build machine stays Windows, assume no ACP.

## 7. What is still needed to close this ticket

- A real run on a supported platform: one permission approved, one denied, result recorded. Not possible on this Windows PC.
- Whether a Windows build exists or WSL can use the Linux one.
- Usage-limit handling (Q5).

## Seen working: Antigravity CLI on this PC (2026-10-29)

`agy` 1.4.8 (`C:\Users\user\Documents\Github\antigravity-cli\agy.exe`), signed in, tested in an empty temp folder with harmless requests.

| Test                                                                        | Result                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headless (`-p`), ask it to create a file and run `curl https://example.com` | the file write succeeded with no prompt (permission mode reported as `request-review`); the shell command was **auto-denied**: "a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied. Add an allow-rule under permissions.allow in settings.json (e.g. command(<target>)). Alternatively, re-run with --dangerously-skip-permissions to auto-approve all tools." |
| `--mode accept-edits`                                                       | shell command still auto-denied                                                                                                                                                                                                                                                                                                                                                                                  |
| `--mode auto`                                                               | "not available for this account"; continues in the default mode, nothing runs                                                                                                                                                                                                                                                                                                                                    |
| `--sandbox`                                                                 | shell command still auto-denied (the sandbox does not approve anything)                                                                                                                                                                                                                                                                                                                                          |

Findings:

- Headless Antigravity cannot ask live. Everything that needs the `command` permission is denied unless an allow rule exists or the skip-everything flag is used. This confirms the planning finding in #6 on this machine.
- The agent's own settings file is `~\.gemini\antigravity-cli\settings.json` (a separate `~\.gemini\settings.json` only holds MCP servers). It has `permissions.allow` (one entry today, written as `command(agy models --help)`), `trustedWorkspaces` and the model.
- The CLI has `--input-format stream-json` and the tool list contains `ask_permission` and `ask_custom_permission`. Whether a two-way streaming session delivers a live permission request to the caller was **not tested**.
- The interactive CLI (`agy` without `-p`) was **not tested**; it is the likely way to get live prompts on Windows, as with Claude Code in Orca's terminal, but that is unverified.

**Not tested yet:** whether an allow rule is honoured headless (needs a temporary edit of Kareem's settings file, which is a standing setting, so it waits for his OK), the streaming two-way mode, the interactive prompt, and Orca's ACP route inside the Linux sandbox.

### Follow-up tests, same day (agy 1.4.10 interactive; 1.4.8 headless)

**Interactive prompt [seen on screen].** Running `agy` in a terminal and asking for `curl https://example.com` shows "Requesting permission for: `curl.exe -s https://example.com`. Run this command?" with 1. Yes, run command. 2. Yes, and always allow in this conversation for commands that start with `curl.exe -s https://example.com`. 3. Yes, and always allow for commands that start with that text (Persist to settings.json). 4. No, cancel. Footer: Tab amend, Ctrl+G edit or expand the command, Esc cancel. So the terminal mode has live prompts at three levels: once, this conversation, permanent, and the rule is the exact command text, not a wildcard.

**Allow rules headless [seen working].** With `command(curl.exe -s https://example.com)` added to `permissions.allow` (settings file backed up and restored afterwards):

- the exact command ran and returned the page;
- the same command with another URL was auto-denied;
- the same command with extra arguments (`-o extra-output.txt`) was auto-denied;
- the same command chained with `& echo chained > chained.txt` was auto-denied; neither file was created.

So the allow rule is held to the exact command in headless mode in these four cases. The earlier worry from planning (#6) that allow rules might be ignored headless was **not reproduced** here. The interactive prompt text says "start with", so prefix behaviour in the terminal mode was not tested; only these four headless variants were.

**Tooling notes.** Antigravity updated from 1.4.8 to 1.4.10 during the session. Kareem ran the interactive test in an Administrator PowerShell window; agents must never run elevated.

**Not tested:** the two-way streaming mode (`--input-format stream-json`), prefix matching in the interactive mode, and Orca's ACP route inside the Linux sandbox (waits until the rest is working, by Kareem's decision).
