---
description: Commit changes using the identity from the git-guard profile (--default-user to use the default git user)
argument-hint: "[--default-user] [what to commit / message hint]"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git config:*), Bash(git -c:*), Bash(git commit:*), Bash(python3 /Users/nnminh/workspaces/agentic-workflows/git-guard/scripts/*), AskUserQuestion
---

Commit changes in this repo as the identity configured in the git-guard profile, or as the default git user.

Request: $ARGUMENTS

## Context

- git-guard profile: !`python3 /Users/nnminh/workspaces/agentic-workflows/git-guard/scripts/setup_profile.py show`
- Repo-local identity: !`git config --local user.name || echo "(not set)"; git config --local user.email || echo "(not set)"`
- Default git identity (local, else global): !`git config user.name || echo "(not set)"; git config user.email || echo "(not set)"`
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
3. **Pick what to commit.** Decide the file list now, but don't stage anything until the user approves the preview in step 5.
   - If the request names a scope (for example "changes related to X"), read the diffs and pick only the files that belong to it. List what you left out and why.
   - With no request, pick all changes the user would expect to commit.
   - Never pick secrets (`.env*`, keys, credentials, `profile.local.json`), `__pycache__/`, or `.DS_Store`.
   - If something is already staged and no request was given, commit just what is staged.
   - If the changes split into clearly separate concerns, you may propose more than one commit. Each one gets its own file list and message.
4. **Write the message.**
   - Use Conventional Commits (`type(scope): summary`, imperative, header ≤ 72 chars) with a short body explaining why.
   - Validate it before committing:
     `python3 /Users/nnminh/workspaces/agentic-workflows/git-guard/scripts/check_message.py --file <msgfile>`.
     Write `<msgfile>` to the session scratchpad. Fix it if the check exits non-zero.
5. **Preview and confirm. Required every time, never skip.** Do this even when the request looks clear, when called from `/push --commit`, or when the user said "just commit". No flag or earlier approval counts as confirmation.
   - First print the preview as normal text in the reply, so the user can read it in full:
     - the author (name + email) and where it came from (profile or default git user),
     - for each proposed commit: the files with their status and line counts (`git diff --stat` plus `git status --short` for new files), then the full proposed message in a code block,
     - the files left out and why.
   - Then ask with AskUserQuestion. Repeat the commit headers and file lists in the question, because the dialog may hide the text above. Offer "Commit", "Edit message" and "Cancel".
     - **Commit:** go to step 6.
     - **Edit message**, or a different file selection given via "Other": apply the change, re-validate the message, and show the preview again. Don't commit until a later answer is "Commit".
     - **Cancel** or anything else: stop. Stage nothing and commit nothing. Tell the user the changes are still uncommitted.
6. **Stage and commit with the identity pinned on the command**, so a different config can never leak in:
   - Stage files by explicit path with `git add -- <paths>`. Don't use `git add -A` or `git add .`.
   - `git -c user.name="<name>" -c user.email="<email>" commit -F <msgfile>`
   - With `--default-user`, a plain `git commit -F <msgfile>` is also fine, since the default identity is what git uses anyway.
   - Commit exactly the files and message the user approved in step 5. If anything changed in between (new edits, hook rewrites), show the preview again.
   - Don't use `--no-verify` or `--amend` unless the user asked for it.
   - If git-guard blocks the command, report the rule ID and message. Don't work around it.
7. **Report the result:** the short hash, the author (`git log -1 --format='%an <%ae>'`) and where it came from (profile or default git user), the files committed, and anything left uncommitted.
