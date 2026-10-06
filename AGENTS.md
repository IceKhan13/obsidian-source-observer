# Source Observer — agent guide

Source Observer is an Obsidian community plugin (TypeScript, bundled by esbuild into `main.js`) that browses any folder on disk, shows syntax-highlighted files and git diffs, searches file contents, shows file history and blame, switches between git worktrees, and lets notes link to or embed live code. It is **desktop-only** (`isDesktopOnly: true`): it reads the file system with Node APIs and runs the user's local `git`.

User documentation is in `README.md`; contributor documentation (architecture, tests, releasing) is in `CONTRIBUTING.md`. This file is the short version for coding agents, plus the pitfalls that are easy to hit.

## Commands

```bash
npm install
npm run dev     # watch build into main.js
npm run build   # tsc type-check + production build — run before every commit
npm run lint    # eslint with eslint-plugin-obsidianmd — must be clean, warnings included
npm test        # vitest: parsers, real-git integration tests, jsdom UI tests
```

CI (`.github/workflows/lint.yml`) runs build, lint and tests on Node 20, 22 and 24 for every push and pull request. All three must pass.

## Layout

```
src/main.ts          plugin lifecycle only (view, ribbon, commands, links, settings tab)
src/commands.ts      command palette commands — IDs are stable, never rename them
src/settings.ts      settings model, defaults, validation
src/links/           obsidian:// links, embed and code block formats, embed processor
src/git/             runs and parses git; parsers are pure functions
src/services/        state and change detection (RepoState, RepoWatcher, FileIndex, ContentSearch, Worktrees)
src/ui/              the view, sidebar sections, content pane and renderers, CodeMirror extensions, menus
src/utils/           file reading, paths, icons, time, request tokens, OS integration
tests/               *.test.ts, helpers.ts (temp git repos), obsidian-shim.ts, electron-shim.ts
docs/images/         README screenshot
```

Dependencies flow one way: `ui → services → git → utils`. `git/` must not import from `services/` or `ui/` (this has caused circular imports before — put I/O helpers that need `GitRepo` in `services/`). The full annotated tree is in `CONTRIBUTING.md`; update it when you add a module.

## Non-negotiable rules

- **Git stays read-only.** Only read-only git commands, always through `GitRepo` so `GLOBAL_ARGS` (`--no-optional-locks`, `--literal-pathspecs`, `core.quotepath=off`) applies. Never write to a repository, the index, refs or config. If you add a git command, add it to the list in the README's **Privacy** section.
- **No network requests, no telemetry.** The plugin works offline.
- **Never break saved data.** Command IDs, settings keys, the embed format (`source-observer` code blocks with `folder`/`file`/`lines`) and the `obsidian://source-observer` link format are public; keep them backward compatible.
- **Don't commit build output** (`main.js`) or `node_modules/`.

## Conventions

- **Components own cleanup.** Every sidebar section, renderer and embed is an Obsidian `Component`. Use `registerDomEvent`, `registerEvent`, `registerInterval` and `register(() => …)`; never leave raw listeners or timers behind.
- **Latest request wins.** Async loads that update the UI take a `LatestRequest` token (`utils/latest.ts`) and check `isCurrent()` before applying results. Cancel superseded work (e.g. `AbortController` for search).
- **Setters must be idempotent.** `RepoState` snapshots arrive often (watchers and polling); `setRepo`/`setFolder`-style methods should return early when nothing changed instead of reloading.
- **Bound everything.** File size (2 MB), search matches (2,000), indexed files (50,000) and history (300 commits) are capped. New features that read data need similar caps, and watchers should only poll while the view is visible.
- **Keep files focused.** Split modules that grow past ~300 lines; keep `main.ts` and `SourceObserverView.ts` to wiring.
- **Async style.** `async`/`await`, errors handled and shown with a `Notice` only when the user explicitly asked for the action.

## Obsidian API pitfalls

- **Only use public API.** Check `node_modules/obsidian/obsidian.d.ts` before relying on something (for example, `MenuItem.dom` is not public). Keep `minAppVersion` (currently 1.7.2) accurate if you need newer APIs.
- **Native menus on macOS.** Obsidian uses native menus by default on macOS, which show only the plain text of a menu item's title (`titleEl.getText()`). If you pass a `DocumentFragment` to `MenuItem.setTitle`, make sure its `textContent` still reads well (see the hidden `.so-wt-sep` separators in `ui/worktreeMenu.ts`). Native menus are not in the DOM, so they cannot be screenshotted.
- **Popout windows.** The `obsidianmd/prefer-active-doc` lint rule rejects `document`/`window`; use `el.doc`, `view.dom.ownerDocument` or `activeDocument`.
- **Icons.** Use Lucide icon names that have existed for a long time (e.g. `user`, `history`, `git-branch`); newer names may be missing in older Obsidian versions.
- **Scopes.** View-level shortcuts are registered on the view's `Scope` (`Mod+F` find in file, `Mod+Shift+F` search in files) and only apply while the view is focused.

## Git pitfalls

- `--literal-pathspecs` is global, so pathspec magic (`:(exclude)`, globs) does not work; filter in JS instead.
- User config can change output formats. Override what matters with `-c` (e.g. `grep.column=false`) and pass explicit flags (`--no-color`, `--no-show-signature`, `--full-name`).
- `git grep` exits with code 1 when nothing matches — that is not an error. Stream large outputs and stop at the cap instead of buffering everything.
- `git grep -P` may be unavailable (git built without PCRE); fall back to `-E`.
- Paths: git prints repository-relative paths; the UI works with paths relative to the opened folder (which may be a subfolder) — use `GitRepo.toFolderRelative`, `repoPath` and `absPath`. On macOS, temp paths resolve to `/private/…`; compare real paths.
- Linked worktrees have a per-worktree `gitDir` and a shared `commonDir`; `git worktree list` orders linked worktrees by path, not creation time.

## Tests

- Every behaviour change needs tests; every bug fix needs a regression test (name it after the bug, as existing tests do).
- Parsers get string-fixture unit tests. Git behaviour gets integration tests against real temporary repositories via `tests/helpers.ts` (`makeRepo`, `write`, `git`, `tempDir`, `remove`) — they need `git` on `PATH`.
- UI tests run in jsdom (`// @vitest-environment jsdom`) against `tests/obsidian-shim.ts`. When code uses an Obsidian API the shim lacks (DOM helpers like `appendText`, `Menu.showAtPosition`, `MenuItem.setChecked`…), extend the shim rather than working around it.
- Use `vi.waitFor` for async UI updates, and clean up components and temp folders in `afterEach`.

## Documentation

`README.md` is deliberately short: what the plugin is, a feature list, usage, installation and privacy. No marketing copy. Update it in the same pull request when you add a feature users should know about, and add any new git command to its **Privacy** list.

UI text and docs follow Obsidian's style guide: sentence case for headings, buttons and settings; "select" rather than "click"; **bold** for UI labels; arrows for navigation (**Settings → Community plugins**); short, jargon-free strings.

The README screenshot (`docs/images/hero.png`) is captured in real Obsidian (default dark theme, 1440×900 at 2×, resized to 1920 px wide). Retake it when the UI changes noticeably.

## Workflow

- One feature or fix per branch and pull request, branched from `master`. Describe what changed and how it was tested.
- Development often happens in git worktrees (e.g. under `.claude/worktrees/`). Run all commands inside the worktree you are working in; each worktree needs its own `npm install`. Exclude in-repo worktree folders via `.git/info/exclude` so they don't show up as untracked.

## Releasing

1. `npm version minor` (or `patch`/`major`) updates `package.json`, `manifest.json` and `versions.json` and creates a tag **without** a `v` prefix (`.npmrc` sets `tag-version-prefix=""`).
2. Push the commit and the tag. `.github/workflows/release.yml` builds the plugin and creates a **draft** GitHub release with `main.js`, `manifest.json` and `styles.css`.
3. Add release notes and publish the draft. The plugin is listed in the community catalog, which picks up new releases from GitHub.

Raise `minAppVersion` before step 1 if the release depends on newer Obsidian APIs.

## References

- Obsidian API: https://docs.obsidian.md
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Developer policies: https://docs.obsidian.md/Developer+policies
- Style guide: https://help.obsidian.md/style-guide
- Manifest validation: https://github.com/obsidianmd/obsidian-releases/blob/master/.github/workflows/validate-plugin-entry.yml
