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
