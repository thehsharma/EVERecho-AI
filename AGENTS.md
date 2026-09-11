# Codex instructions for EVERecho-AI

## Project context

- Repository: https://github.com/thehsharma/EVERecho-AI
- Read README.md and CLAUDE.md for the existing architecture, setup, and product constraints before changing application code.
- Follow any AGENTS.md files in the directories you edit, including apps/web/AGENTS.md.
- Use Node.js 22 or newer and the pnpm version pinned in package.json. Preserve the pnpm lockfile.
- Keep changes focused on the user's requested work and preserve unrelated edits.

## Validation

- Run checks appropriate to the change before committing. For application changes, use the relevant tests plus pnpm lint and pnpm typecheck.
- pnpm verify runs the full verification pipeline. Integration tests and evaluations require the database and relevant setup described in README.md; browser tests require a running stack.
- For documentation-only changes, review the diff and formatting; application tests are not required.
- Report checks that failed or could not run accurately. Never claim that an unrun check passed.

## GitHub syncing

The repository owner requests that completed work in this project be saved to GitHub as part of each coding task, unless they explicitly ask to keep that task local or uncommitted.

1. Before editing, inspect git status, the current branch, and origin. Fetch remote updates when available and integrate them without discarding local work.
2. Work on the task's existing branch. Respect branch protections and existing pull-request workflows; do not switch to main merely to sync.
3. Review the final diff and stage only the files belonging to the task. Keep secrets, .env files, private recordings, user data, dependencies, and temporary outputs out of commits.
4. After appropriate validation, create a descriptive commit and push it to the matching branch on origin. If a new task branch has no upstream, set its upstream when pushing.
5. Do not force-push, overwrite unrelated changes, or automatically merge a pull request. If access, conflicts, or branch protection prevent syncing, preserve the work and report the exact blocker.
6. Verify the pushed commit is present on the remote branch. Report the branch, commit, validation results, and any remaining local changes.

These are task-completion instructions, not a background file watcher. Only work saved and committed in this repository is synced; chats and work in unrelated folders are not uploaded automatically.
