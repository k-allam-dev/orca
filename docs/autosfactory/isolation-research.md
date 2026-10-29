# Isolated environment per ticket (WSL2): research notes (issue #31)

Status: **measured; the agent-run criterion is now met.** Measurements below were run on Kareem's PC on 2026-10-27 and 2026-10-28. "Seen working" means I ran it and saw the output. The criterion "one agent run inside an isolated environment that fails to read or write outside its project" is **met** (section "Agent run inside the environment"). Still open: hooks reaching the board, Antigravity inside Linux, and the worktree-in/result-out route.

Setup: WSL 2.6.3, kernel 6.6.87.2, Ubuntu 26.04.1 LTS. The default WSL distro on this PC is `docker-desktop`, so every command must name the distro (`wsl -d <name>`). Test distro `af-test` is a copy of a fresh Ubuntu in `C:\Users\user\wsl-af-test` (remove with `wsl --unregister af-test`).

## Design 1: one WSL distro per ticket [seen working]

| What                                         | Result                 |
| -------------------------------------------- | ---------------------- |
| Template export (`wsl --export`, one time)   | 44.9 s, 1,223 MB tar   |
| Create a ticket environment (`wsl --import`) | 31.6 s                 |
| Disk per environment                         | 1,420 MB (`ext4.vhdx`) |
| Start after switching drives off             | 5.9 s                  |

A leaner template (no cached packages) should cut time and disk; not tried.

## Design 2: one shared hardened distro, one Linux user per ticket [seen working]

| What                                                      | Result                                         |
| --------------------------------------------------------- | ---------------------------------------------- |
| Create two ticket users (`useradd -m`)                    | 0.3 s for both, no extra disk beyond the files |
| A ticket user reads another ticket's file (home mode 700) | "Permission denied"                            |
| A ticket user lists the main user's home                  | "Permission denied"                            |
| A ticket user runs `sudo`                                 | refused                                        |
| A ticket user lists another user's processes (`ps -u`)    | **visible** (names and command lines)          |

Weaker than design 1: all tickets share one filesystem, one kernel and one process list. File access between tickets is protected only by Unix permissions.

## Design 3: one container per ticket [not measured]

Docker Desktop 29.8.2 is installed but its engine was not running, and starting it would use a large share of this 15 GB PC. Not measured. Expectation (not tested): containers start in seconds and share the Docker VM, so isolation sits between designs 1 and 2, but they add a daemon that runs as root.

## Can the agent reach the Windows PC? [seen working]

Default Ubuntu sees all of `C:\` at `/mnt/c`. With this in `/etc/wsl.conf` inside the environment and a restart of that distro:

```
[automount]
enabled=false
mountFsTab=false
[interop]
enabled=false
appendWindowsPath=false
```

- `ls /mnt/c` is empty, `cat /mnt/c/Windows/win.ini` fails ("No such file or directory"), and `cmd.exe` cannot be run. `powershell.exe` is not on PATH.
- The only Windows-type mount left is `/usr/lib/wsl/drivers`, read-only (GPU drivers). `/mnt/wsl` and `/mnt/wslg` still exist and were not examined.

**Network gap, then closed [seen working].** From inside, the Windows host (default gateway 172.30.192.1) answered on ports 445 (file sharing) and 135 (RPC). Installing `nftables` in the environment and adding, as root, a rule that rejects `172.16.0.0/12` (which contains the host) made both ports blocked, while the internet still worked (GitHub API returned 200). A ticket user could **not** remove the rule ("Operation not permitted"). So the environment can be limited to the internet only. Caveats: the rule must be created as root before the agent starts and re-applied each boot (not automated); the 172.16.0.0/12 range was an assumption that the host sits there, which was true on this PC, but the address range can change between machines or WSL versions, so the rule should be built from the actual gateway at startup.

## Claude Code inside the environment [seen working, partly]

Installed with Node 22 (Ubuntu package) and `npm install -g @anthropic-ai/claude-code`: 319 s including Node, version 2.1.312, runs as the normal user. **Not run yet:** it needs a sign-in inside the environment, which only Kareem can do.

## Agent run inside the environment [seen working, 2026-10-28]

Claude Code 2.1.312, signed in by Kareem inside `af-test`, was run as the normal Linux user with `--dangerously-skip-permissions` (the way Orca launches it by default), from `~/proj`, and told to run eight boundary commands and report each result without workarounds. It ran in 11 s. Result, as reported by the agent:

| #   | Command                                      | Result                                           |
| --- | -------------------------------------------- | ------------------------------------------------ |
| 1   | `ls /mnt/c`                                  | succeeded, **empty** (the drive is not mounted)  |
| 2   | `cat /mnt/c/Windows/win.ini`                 | failed: `No such file or directory`              |
| 3   | `/mnt/c/Windows/System32/cmd.exe /c echo hi` | failed: `No such file or directory` (exit 127)   |
| 4   | `cat /home/tkt1/s.txt` (another user's file) | failed: `Permission denied`                      |
| 5   | `ls /home/tkt2`                              | failed: `Permission denied`                      |
| 6   | `echo test > /etc/sandbox-write-test`        | failed: `Permission denied`                      |
| 7   | `echo ok > ./inside-project.txt`             | succeeded (inside its own project)               |
| 8   | `sudo -n true`                               | failed: `interactive authentication is required` |

**Finding to act on:** command 8 shows the default user _has_ sudo (it needs a password, which the agent does not have). The agent must therefore run as a dedicated ticket user (design 2) that is not in the `sudo` group, as `tkt2` was, not as the default user. Even with all prompts skipped, the agent could not read outside its project or the Windows PC.

Not covered by this run: the agent was told to try these commands, so it shows the environment's limits, not the agent's own behaviour; it was not tried against hostile prompts, network exfiltration to the internet (the internet is open), or the Windows host firewall rule (tested separately above).

## Orca and WSL [read in code, file names only]

`src/wsl-guest/` holds a guest-side hook server and dispatcher (`agent-hook-server.ts`, `dispatcher-*.ts`) and `src/main/wsl-*.ts` handles distro availability, bash commands, contained deletes and approved roots, which suggests agent hooks and status can reach the app from inside a WSL distro. **Not checked:** how Orca picks the distro for a workspace, whether it can target a per-ticket distro, and whether the guest code needs the `/mnt/c` mount or the Windows bridge that is switched off here.

## Answers to the ticket's questions

1. Setup time, disk, start: design 1 = 32 s, 1.4 GB, 6 s; design 2 = 0.3 s, about 0 extra disk; design 3 not measured.
2. Windows drive and command bridge off, failed read of `C:\`: **yes, seen** (above).
3. Start Claude Code and Antigravity inside, hooks reaching the board: Claude Code installed, not run; Antigravity not tried; hooks not checked.
4. Sign-ins without copying Windows secrets: each environment needs its own sign-in (Claude Code stores it under the Linux user's home). Jira tokens stay in Windows because intake runs there. Worktree in and result out: **not decided or tested**; likely `git clone` from the project inside the environment and a push or patch export back.
5. Antigravity ACP route inside Linux: not tried (needs a Google sign-in; Orca's pinned server has Linux builds, so it may work).
6. Network: can be limited to internet only with a root-owned `nft` rule (above). Per-host allowlists were not tried.
7. Pause, cancel, restart recovery: design 1: cancel is `wsl --unregister` (disk gone at once); a stopped distro keeps its files, so pause can be "terminate the distro". Design 2: cancel is `userdel -r` and `kill -u`; pause needs process freezing. Not tested for either.

## Provisional recommendation (to confirm after the agent run)

Use **design 2** (one hardened distro, a Linux user per ticket) as the base: 0.3 s per ticket and no extra disk against 32 s and 1.4 GB. Add the root-owned firewall rule and the drive and command-bridge switch-off. Treat design 1 as the stronger option if you decide tickets must not share a filesystem or process list. This changes **#22** (safe launch: the agent launches as the ticket's Linux user and the permission policy lives outside its reach) and **#23** (the runner creates and deletes the user and its worktree, and re-applies the firewall rule).

## Still to do

1. Check that agent hooks and status still reach Orca from inside the environment (needs the app running with a workspace in the environment).
2. Try Antigravity inside the environment (needs a Google sign-in by Kareem).
3. Decide and test how the worktree gets in and the result gets out for review (#24).
4. Automate the firewall rule and ticket-user creation (part of #22/#23).

## Creating the sandbox distro

The runner (`WslTicketSandbox`, `src/main/autosfactory/sandbox/`) expects one hardened distro named `autosfactory` (override with the `AUTOSFACTORY_WSL_DISTRO` environment variable). Created once by hand; the app never creates or deletes the distro, only ticket users inside it.

1. Export a fresh Ubuntu: `wsl --export Ubuntu C:\wsl\ubuntu-base.tar` (about 45 s, 1.2 GB).
2. Import it under the sandbox name: `wsl --import autosfactory C:\wsl\autosfactory C:\wsl\ubuntu-base.tar` (about 30 s).
3. Inside it (`wsl -d autosfactory -u root`), install what ticket users need: `apt-get update && apt-get install -y nftables git`, plus Node 22 and `npm install -g @anthropic-ai/claude-code` for the agent. Sign in to the agent once per ticket user (the sign-in lives in that user's home).
4. Write `/etc/wsl.conf` (ensureReady also writes the missing keys itself, but a restart is still needed once):

```
[boot]
systemd=true

[automount]
enabled=false
mountFsTab=false

[interop]
enabled=false
appendWindowsPath=false
```

5. Apply it: `wsl --terminate autosfactory`.
6. Base state to keep: no `sudo` group membership for ticket users (the sandbox refuses a user in sudo, admin, wheel or root), no ticket users (they are created per ticket as `t-<key>`, tagged `af-ticket=<KEY>` in the account comment), and no secrets in the base image. Do not make `autosfactory` the default distro.
7. On every ticket start the runner calls `ensureReady()`. It checks the distro exists, the wsl.conf keys, that `/mnt/c` is empty and no `WSLInterop` entry is registered, then replaces the root-owned nft table `inet fw` (only root can change it, a ticket user gets "Operation not permitted"). The table, in order: accept everything leaving through `lo`; accept DNS (tcp and udp port 53) to the nameserver addresses found in `/etc/resolv.conf` (and `/run/systemd/resolve/resolv.conf` when present); reject the default gateway and all private ranges `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10` (IPv6 `fc00::/7`, `fe80::/10`); everything else (the internet) stays open. The `lo` rule is needed: the reject answers and the WSL DNS stub (`10.255.255.254`, which sits on `lo`) are sent to the distro's own private addresses, and without it DNS and the reject itself time out. Pass `installNftables: true` to let it `apt-get install nftables` when missing.

## Shared repos folder (`afrepos`)

Tickets do not clone from a URL. The distro holds one shared folder of bare repos, `/srv/autosfactory/repos/<repoKey>.git` (constants in `src/shared/autosfactory/sandbox-config.ts`), owned by the system user `afrepos`. The folder and the repos are mode 755/644-style: ticket users can read and clone but cannot write (verified: `touch` and a ref write are "Permission denied"), so no ticket can change what the next ticket starts from. No git credentials ever enter the distro.

Creating `afrepos`: `ensureReady()` does it (idempotent). By hand it is `useradd -m -s /bin/bash afrepos && chmod 700 /home/afrepos`, then `mkdir -p /srv/autosfactory/repos && chown afrepos:afrepos /srv/autosfactory/repos && chmod 755 /srv/autosfactory/repos`. `ensureReady()` also sets the system-wide `git config --system --add safe.directory '/srv/autosfactory/repos/*'` (wildcard needs git 2.46 or newer; af-test has 2.53.0) so a ticket user can clone repos owned by `afrepos` without the "dubious ownership" error, and installs the root-owned helper `/usr/local/lib/autosfactory/update-repo.sh`.

Windows-to-distro flow, `updateSharedRepo(repoKey, windowsRepoPath)`:

1. On Windows, in the Orca project folder: `git fetch origin develop` (the Windows git login does this; a failed fetch does not stop the start, see "Stale code is fine" below), then `git bundle create <temp>.bundle refs/remotes/origin/develop`.
2. The bundle file is streamed into the distro through stdin (no UNC paths) to `update-repo.sh` running as `afrepos`, which writes it to a private temp dir, creates the bare repo if missing, and runs `git fetch --update-head-ok --force <bundle> +refs/remotes/origin/develop:refs/heads/develop` and points HEAD at `develop`.
3. The Windows temp folder is deleted afterwards, also on failure.

Then `createSession` makes a local clone as the ticket user (`git clone --local --no-hardlinks --no-checkout` from the shared bare repo into `~/work/<KEY>`, owned by the ticket user) and creates the work branch from `origin/develop` of the shared repo (the remote develop, never a local branch; nothing is ever committed on develop). If a branch with that name already exists in the clone it is reused. The ticket gets a fully independent copy it can change freely; its `origin` is the read-only shared repo, so pushing or opening a PR is a separate hand-off step (#24). `repoKey` is validated like a ticket key (letters, digits, `.`, `_`, `-`, no `..`, no slash, no `.git` suffix).

### Stale code is fine, refresh every 5 hours (decisions on issue #23, 2026-10-29)

- A failed `git fetch origin develop` on Windows does not fail a start. `updateSharedRepo` keeps the last copy already in the shared repo and returns `{ warning }`; the runner stores it on the ticket as `lastWarning` (cleared by the next clean start). Only when the shared repo does not exist yet is a failed fetch an error.
- `SharedRepoRefresher` (`src/main/autosfactory/runner/shared-repo-refresher.ts`) refreshes all repos tickets use every 5 hours (`SHARED_REPO_REFRESH_INTERVAL_MS`) and on demand from the "Refresh code" button on the Jira bar under the board header, which shows the last refresh time and a per-repo result (up to date, stale with the warning, or error). It is started in `registerTicketHandlers`. While the sandbox is not wired, the status is "The sandbox is not set up yet" instead of an error.
- Work branch name follows Jira: `<ISSUE-KEY>-<summary slug>`, e.g. `JS-2652-replace-and-add-documents-on-balance-transfer-requests`. The key stays as written, the summary is lower-cased, every run of non-alphanumeric characters becomes one `-`, leading and trailing `-` are trimmed, the slug is cut at 60 characters on a word boundary, and an empty summary gives just the key (`ticketBranchName(key, title)`). The result passes `assertBranchName` (which also now rejects a path part starting with `.`).
- A failed start (direct or queued) sets `agentStatus` to `failed` and stores the message in `lastError`; both are shown as a small red line on the ticket cards.

Manual check on `af-test` (2026-10-29, `scripts/autosfactory-refresh-smoke.ts af-test`): with the Windows project's `origin` renamed away, `updateSharedRepo` returned the warning and `createSession` still cloned the previous copy, creating `ZZTEST-2-replace-add-documents-v2-balance-transfer` (punctuated summary) and `ZZTEST-3-a-very-long-summary-that-goes-on-and-on-about-balance` (long summary); a second `createSession` for the same ticket reused its branch; after restoring `origin` and pushing a commit, `SharedRepoRefresher.refreshNow()` reported ok and the shared develop contained the new file.

Manual check on `af-test` (2026-10-28, `scripts/autosfactory-sandbox-smoke.ts af-test`): session create, isolation probes, stop and destroy all worked; see the issue comment for timings.

Manual check of the shared repos flow and firewall on `af-test` (2026-10-28, `scripts/autosfactory-sandbox-smoke.ts af-test`): the clone had develop's files on the new branch, the ticket user could write and commit in its own copy and not in the shared repo, a second update with a new commit reached a new ticket (the first ticket kept its own state), the gateway (Windows host, port 445), `192.168.1.1`, `10.1.2.3` and `169.254.169.254` were refused immediately, `1.1.1.1:443` and DNS worked, and `nft delete table inet fw` was refused.
