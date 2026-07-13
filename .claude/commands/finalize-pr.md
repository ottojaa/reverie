# Finalize PR

Prepare the current work for a pull request: get onto a feature branch, commit, make lint/typecheck/format green, rebase on `main`, push, and open the PR.

Work through these steps in order. Stop and ask the user if anything is ambiguous (e.g. commit message intent, or unexpected failures you can't resolve).

## 1. Check state

- `git status` and `git diff` to see what's changed.
- If on `main`: create a feature branch first — `git switch -c <short-descriptive-name>`. Use no slashes in the branch name (keep it simple, kebab-case).
- If already on a feature branch, stay on it.

## 2. Commit

- Stage the relevant changes (`git add ...`) and commit with a clear, conventional message (`fix:`, `feat:`, `chore:`, etc.) describing the change — match the style of recent commits (`git log --oneline -10`).

## 3. Format

- Run `pnpm format` (`nx format:write`).
- If it changed files, `git add` + amend or add a `chore: format` commit.

## 4. Lint + typecheck (loop until green)

- Run `pnpm lint` — this runs **both** lint and typecheck (`nx run-many -t lint typecheck`).
- For autofixable lint issues, run `pnpm lint:fix`.
- Fix remaining issues manually, commit the fixes, and re-run `pnpm lint` until it passes cleanly.
- Do not proceed to push while lint/typecheck is red.

## 5. Rebase on main

- `git fetch origin`
- `git rebase origin/main`
- Resolve any conflicts, then re-run step 4 if code changed during conflict resolution.

## 6. Push

- `git push -u origin <branch>` (use `--force-with-lease` if you rebased an already-pushed branch).

## 7. Open the PR

- `gh pr create --base main --fill` (or write an explicit `--title` / `--body` summarizing the change and how it was verified).
- Report the PR URL back to the user.
