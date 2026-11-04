---
description: Push the current branch with the git-guard SSH key (--commit to commit first)
argument-hint: "[--commit [what to commit / message hint]] [--force]"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git config:*), Bash(git -c:*), Bash(git commit:*), Bash(git push:*), Bash(git rev-parse:*), Bash(git remote:*), Bash(git branch:*), Bash(python D:/workspace/HAISE/agents/git-guard/scripts/*)
---

Push the current branch using the SSH key and account from the git-guard profile.

Arguments: $ARGUMENTS

## Context

- git-guard profile: !`python D:/workspace/HAISE/agents/git-guard/scripts/setup_profile.py show`
- Branch: !`git branch --show-current`
- Upstream: !`git rev-parse --abbrev-ref --symbolic-full-name @{u}`
- Remotes: !`git remote -v`
- Status: !`git status --short`

## Steps

1. **Parse the flags.**
   - `--commit`: commit first. Follow every step in `.claude/commands/commit.md`. Use the text after `--commit` (with other flags removed) as its request. If that commit stops or fails, don't push.
   - `--force`: push with `--force-with-lease`, never a plain `--force`.
   - With no `--commit` flag, don't commit or stage anything. If the working tree is dirty, push the existing commits and mention that uncommitted changes were not included.
2. **Check before pushing.** Stop and explain if any of these fail:
   - `ssh_key` in the profile is set. If it's `(unset)`, tell the user to run `setup_profile.py init --ssh-key <path>`.
   - The remote is SSH (`git@github.com:...`) and its owner matches `github_user` from the profile, when that value is set.
   - The branch isn't detached, and there is something to push (`git log @{u}..HEAD`, or there's no upstream yet).
   - If the branch is `main`/`master`, or `--force` was given, ask the user to confirm before pushing.
3. **Push with the key pinned on the command**, using the profile's `ssh_key`:
   `git -c core.sshCommand="C:/WINDOWS/System32/OpenSSH/ssh.exe -i \"<ssh_key>\" -o IdentitiesOnly=yes" push [--force-with-lease] [-u origin <branch> if no upstream]`
   - Never use `gh`.
   - Don't use `--no-verify`.
   - If git-guard blocks the command, report the rule ID and message. Don't work around it.
4. **Report the result:** the commit range that was pushed and the remote branch. If there was no upstream before this push, also give the compare URL `https://github.com/<owner>/<repo>/compare/<branch>?expand=1` so the user can open a PR.
