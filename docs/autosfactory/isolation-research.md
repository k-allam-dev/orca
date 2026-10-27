# Isolated environment per ticket (WSL2): research notes (issue #31)

Status: **partial**. Windows and WSL measurements below were run on Kareem's PC on 2026-10-27. Anything not listed as seen working is marked read-in-code or not checked. The acceptance criterion "one agent run inside the environment" is **not met yet**: it needs Claude Code installed and signed in inside the environment.

Setup: WSL 2.6.3, kernel 6.6.87.2, Ubuntu 26.04.1 LTS (default distro on this PC is `docker-desktop`, so commands must use `wsl -d <name>`). Test distro `af-test` was created as a copy of a fresh Ubuntu and sits in `C:\Users\user\wsl-af-test` (safe to delete with `wsl --unregister af-test`).

## Measured: design 1, one distro per ticket [seen working]

| What                                                            | Result                 |
| --------------------------------------------------------------- | ---------------------- |
| Template export (`wsl --export`, one time)                      | 44.9 s, 1,223 MB tar   |
| Create a ticket environment (`wsl --import` from template)      | 31.6 s                 |
| Disk per environment                                            | 1,420 MB (`ext4.vhdx`) |
| Start after switching drives off (terminate, start, run checks) | 5.9 s                  |

Setup cost is mostly the import and the disk. A smaller template (no desktop packages, no cached files) should cut both; not tried. A fresh Ubuntu already weighs about 1.2 GB.

## Measured: can the agent reach the Windows PC? [seen working]

Default Ubuntu sees all of `C:\` at `/mnt/c`. With this in `/etc/wsl.conf` inside the environment and a restart:

```
[automount]
enabled=false
mountFsTab=false
[interop]
enabled=false
appendWindowsPath=false
```

Results inside `af-test` after the restart:

- `ls /mnt/c` shows nothing.
- `cat /mnt/c/Windows/win.ini` fails: "No such file or directory".
- Running `/mnt/c/Windows/System32/cmd.exe` fails: "No such file or directory". `powershell.exe` is not on PATH.
- The only Windows-type mount left is `/usr/lib/wsl/drivers`, mounted read-only (GPU drivers).
- `/mnt/wsl` and `/mnt/wslg` still exist (WSL system folders; not examined).

**Gap: the network.** From inside the environment the Windows host (default gateway 172.30.192.1) accepts connections on port 445 (file sharing) and 135 (RPC). Ports 3389 and 5985 did not answer. Internet access works (GitHub API returned 200). Whether an agent could use the open host ports to reach Windows files was not tested; it would need Windows credentials, but it is a route that exists. A Windows Firewall rule limiting what WSL can reach, or WSL mirrored networking settings, should be tried before calling this isolated. Not checked.

## Read in code: Orca already has WSL support [code, file names only]

`src/wsl-guest/` holds a guest-side agent hook server and a dispatcher (`agent-hook-server.ts`, `dispatcher-*.ts`), and `src/main/wsl-*.ts` handles availability, distro lists, bash commands, contained deletes and approved roots. That suggests agent hooks and status can reach the app from inside a WSL distro. **Not checked:** how Orca picks the distro for a workspace, whether it can be pointed at a per-ticket distro, and whether the guest code needs `/mnt/c` or interop that we have just switched off. Needs a real run.

## Not checked yet

- Q1 other designs: design 2 (shared distro, separate Linux user per ticket) and design 3 (containers) have no measurements.
- Q3 starting Claude Code and Antigravity inside the environment, and hooks reaching the board.
- Q4 sign-ins into the environment without copying Windows secrets, worktree in and result out for #24.
- Q5 Antigravity's ACP route inside Linux (needs Google sign-in; Kareem must do it).
- Q6 network limits (see the gap above).
- Q7 pause, cancel and restart recovery. Design 1 note: cancel is `wsl --unregister` (instant removal of the disk); pause needs more thought.

## Next steps for the person at the PC

1. Inside `af-test`, install Claude Code (needs internet; Linux install) and sign in. Then ask it to read `/mnt/c` and write outside its project, and keep the failed attempts as evidence.
2. Decide how the worktree gets into the environment (copy, or clone from the repository inside).
