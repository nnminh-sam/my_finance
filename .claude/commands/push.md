---
description: Push the current branch (pinned SSH key from git-guard, or default git credentials when no key is set) (--commit to commit first, --upstream for a new branch)
argument-hint: "[--commit [--default-user] [what to commit / message hint]] [--upstream] [--default-auth]"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git config:*), Bash(git -c:*), Bash(git commit:*), Bash(git push:*), Bash(git rev-parse:*), Bash(git remote:*), Bash(git branch:*), Bash(git ls-remote:*), Bash(python3 /Users/nnminh/workspaces/agentic-workflows/git-guard/scripts/*), AskUserQuestion
---

Push the current branch. Auth comes from the git-guard profile's SSH key when one is set; otherwise from the default git setup (HTTPS + macOS keychain credential helper, or your default SSH agent/config).

Arguments: $ARGUMENTS

## Context

- git-guard profile: !`python3 /Users/nnminh/workspaces/agentic-workflows/git-guard/scripts/setup_profile.py show`
- Branch: !`git branch --show-current`
- Branch and upstream (first line reads `## <branch>...<remote>/<branch>` when an upstream exists, `## <branch>` when not): !`git status --short --branch`
- Remotes: !`git remote -v`
- Credential helper: !`git config credential.helper`

## Steps

1. **Parse the flags.**
   - `--commit`: commit first. Follow every step in `.claude/commands/commit.md`. Pass the text after `--commit` (including `--default-user`, with push flags removed) as its request. If that commit stops or fails, don't push.
   - `--upstream` (alias `-u`): the branch has no upstream yet. Publish it to `origin` and set tracking with `git push -u origin <branch>`.
   - `--default-auth`: ignore the profile's `ssh_key` and push with the default git auth.
   - Force pushing is not supported. If the arguments contain `--force`, `-f`, `--force-with-lease`, `--force-if-includes` or a `+<refspec>`, stop and tell the user this command never force-pushes. Don't fall back to a normal push in that case.
   - With no `--commit` flag, don't commit or stage anything. If the working tree is dirty, push the existing commits and mention that uncommitted changes were not included.
2. **Pick the auth mode.**
   - **Pinned key:** `ssh_key` is set in the profile, the remote is SSH (`git@github.com:...`), and `--default-auth` was not given.
   - **Default auth:** everything else — `ssh_key` is `(unset)`, the remote is HTTPS, or `--default-auth` was given. No SSH key is needed; git uses the credential helper (`osxkeychain`) for HTTPS or the default SSH config for SSH remotes.
   - If `ssh_key` is set but the remote is HTTPS, use default auth and mention that the key was not used.
3. **Check before pushing.** Stop and explain if any of these fail:
   - The remote owner (from `git@github.com:<owner>/...` or `https://github.com/<owner>/...`) matches `github_user` from the profile, when that value is set.
   - The branch isn't detached.
   - **No upstream and no `--upstream` flag:** stop. Tell the user the branch has no upstream and to run `/push --upstream` to publish it. Don't add `-u` on your own.
   - **Upstream exists and `--upstream` was given:** ignore the flag, push normally, and say so.
   - There is something to push: `git log --oneline @{u}..HEAD` when an upstream exists, or `git log --oneline origin/<default-branch>..HEAD` (falling back to `git log --oneline -10`) for a new branch. If nothing is ahead, stop.
   - For a new branch, also check the remote doesn't already have `<branch>` (`git ls-remote --heads origin <branch>`, with the same `-c core.sshCommand=...` as the push in pinned-key mode). If it does, stop and explain. Overwriting it would need a force push, and this command never does one.
4. **Always ask for confirmation**, every time, using AskUserQuestion. The flags never count as confirmation. The question must show:
   - the branch, the remote and remote branch, and whether this will create a new upstream (`-u`),
   - the auth mode (pinned key or default auth),
   - the commits that will be pushed (short hash + subject),
   - the exact `git push` command that will run (with the key path, never its contents).
   Offer "Push" and "Cancel". Push only on an explicit "Push". On "Cancel" or any other answer, stop without pushing.
5. **Push.**
   - Pinned key: `git -c core.sshCommand="ssh -i \"<ssh_key>\" -o IdentitiesOnly=yes" push [-u origin <branch>]`
   - Default auth: `git push [-u origin <branch>]`
   - Never use `--force`, `-f`, `--force-with-lease`, `--force-if-includes`, `--mirror`, `--delete` or `+` refspecs.
   - Never use `gh`.
   - Don't use `--no-verify`.
   - If the push is rejected (for example non-fast-forward), report it and stop. Don't retry with force or rebase on your own.
   - If auth fails in default-auth mode, report the error and suggest the user run `! git push` once in the prompt so the keychain stores the credential. Don't try other auth methods.
   - If git-guard blocks the command, report the rule ID and message. Don't work around it.
6. **Report the result:** the commit range that was pushed, the remote branch, and the auth mode used. If this push set a new upstream, also give the compare URL `https://github.com/<owner>/<repo>/compare/<branch>?expand=1` so the user can open a PR.
