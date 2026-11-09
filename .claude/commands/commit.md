---
description: Commit changes using the identity from the git-guard profile (--default-user to use the default git user)
argument-hint: "[--default-user] [what to commit / message hint]"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git config:*), Bash(git -c:*), Bash(git commit:*), Bash(python3 /Users/nnminh/workspaces/agentic-workflows/git-guard/scripts/*)
---

Commit changes in this repo as the identity configured in the git-guard profile, or as the default git user.

Request: $ARGUMENTS

## Context

- git-guard profile: !`python3 /Users/nnminh/workspaces/agentic-workflows/git-guard/scripts/setup_profile.py show`
- Repo-local identity: !`git config --local user.name; git config --local user.email`
- Default git identity (local, else global): !`git config user.name; git config user.email`
- Branch: !`git branch --show-current`
- Status: !`git status --short --untracked-files=all`
- Recent commits (match their style): !`git log --oneline -8`

## Steps

1. **Parse the flags.**
   - `--default-user`: commit as the default git user (`git config user.name` / `user.email`, which resolves local then global). Remove the flag from the request before using the rest as a scope hint.
2. **Resolve the author.**
   - **With `--default-user`:** use the default git identity above. If either value is empty, stop and tell the user to run `git config --global user.name "<name>"` / `user.email "<email>"`.
   - **Without it:** use `git_name` and `git_email` from the git-guard profile. If `git_email` is a comma-separated list, use the first entry.
     - If a profile value is `(unset)`, fall back to the default git identity (local, else global) and say so in the report.
     - If a value is still empty, stop. Tell the user how to set it:
       `python3 /Users/nnminh/workspaces/agentic-workflows/git-guard/scripts/setup_profile.py init --git-name "<name>" --git-email "<email>"`
       or to re-run with `--default-user` after setting global git config.
   - Don't change any git config or profile yourself.
3. **Pick what to commit.**
   - If the request names a scope (for example "changes related to X"), read the diffs and stage only the files that belong to it. List what you left out and why.
   - With no request, stage all changes the user would expect to commit.
   - Never stage secrets (`.env*`, keys, credentials, `profile.local.json`), `__pycache__/`, or `.DS_Store`.
   - If something is already staged and no request was given, commit just what is staged.
   - Stage files by explicit path with `git add -- <paths>`. Don't use `git add -A` or `git add .`.
4. **Write the message.**
   - Use Conventional Commits (`type(scope): summary`, imperative, header ≤ 72 chars) with a short body explaining why.
   - Validate it before committing:
     `python3 /Users/nnminh/workspaces/agentic-workflows/git-guard/scripts/check_message.py --file <msgfile>`.
     Write `<msgfile>` to the session scratchpad. Fix it if the check exits non-zero.
5. **Commit with the identity pinned on the command**, so a different config can never leak in:
   `git -c user.name="<name>" -c user.email="<email>" commit -F <msgfile>`
   - With `--default-user`, a plain `git commit -F <msgfile>` is also fine, since the default identity is what git uses anyway.
   - Don't use `--no-verify` or `--amend` unless the user asked for it.
   - If git-guard blocks the command, report the rule ID and message. Don't work around it.
6. **Report the result:** the short hash, the author (`git log -1 --format='%an <%ae>'`) and where it came from (profile or default git user), the files committed, and anything left uncommitted.
