# Contributing to Source Observer

Thanks for helping. Bug reports, ideas and pull requests are all welcome — for anything bigger than a small fix, please [open an issue](https://github.com/IceKhan13/obsidian-source-observer/issues) first so we can agree on the approach.

## Development setup

You need Node.js 20 or later, git, and an Obsidian vault you don't mind experimenting in.

```bash
git clone https://github.com/IceKhan13/obsidian-source-observer.git
cd obsidian-source-observer
npm install
```

Link the project into a test vault so Obsidian loads your build:

```bash
ln -s "$PWD" "<vault>/.obsidian/plugins/source-observer"
```

Then enable **Source Observer** in **Settings → Community plugins** of that vault.

| Command | What it does |
| --- | --- |
| `npm run dev` | Rebuilds `main.js` on every change. Reload the plugin (or Obsidian) to pick it up. |
| `npm run build` | Type-checks and makes a production build. |
| `npm run lint` | ESLint, including Obsidian's plugin rules. |
| `npm test` | Unit, git integration and DOM tests with Vitest. |

CI runs build, lint and tests on Node 20, 22 and 24 for every push and pull request.

## Tests

Tests live in `tests/` and run in Node, with jsdom for UI tests:

- **Parsers** (`git status`, `log`, `blame`, `grep`, `worktree list`) are pure functions with plain string fixtures.
- **Git integration tests** create real temporary repositories with `tests/helpers.ts` (`makeRepo`, `write`, `git`), so they need `git` on your `PATH`.
- **UI tests** render real components against `tests/obsidian-shim.ts`, a small stand-in for the parts of the Obsidian API the plugin uses. If you use a new Obsidian API, add it to the shim.

Please add or update tests with every behaviour change; bug fixes should come with a regression test.

## Architecture

```
src/
  main.ts                     plugin lifecycle
  commands.ts                 command palette commands
  settings.ts                 settings model, defaults, validation
  links/
    sourceLink.ts             link, embed and code block formats; embed parsing
    register.ts               obsidian:// handler and code block processor
  git/
    GitRepo.ts                resolves root/git dir/prefix; runs git with --no-optional-locks
    status.ts                 pure parser for `git status --porcelain=v2`
    diffSources.ts            loads the two sides of a diff (changes and commits)
    grep.ts                   `git grep` arguments and output parsing
    history.ts                pure parser for a file's `git log --follow`
    blame.ts                  pure parser for `git blame --porcelain`
    worktrees.ts              pure parser for `git worktree list --porcelain`
  services/
    RepoState.ts              single-flight status refresh with stale-result protection
    RepoWatcher.ts            watches the git dir and working tree; polls only while visible
    FileIndex.ts              cached file list for search (git ls-files or a bounded walk)
    ContentSearch.ts          search in files: git grep, or reading indexed files; match previews
    Worktrees.ts              worktree summaries (changes, ahead/behind) and folder mapping
  ui/
    SourceObserverView.ts     layout and wiring
    sidebar/                  Files, Search, Changes and History sections, tree, keyboard navigation
    pane/                     content pane and its renderers (code, diff, message)
    editor/                   CodeMirror theme, languages, diff stats, blame gutter
    embed/                    live code embeds rendered inside notes
    fileMenu.ts               right-click menu for files, folders and changes
    worktreeMenu.ts           the worktree switcher menu
  utils/                      file reading, icons, paths, request tokens, OS integration
```

A few principles hold the design together:

- **Read-only git.** Only read-only git commands are used, always with `--no-optional-locks`, so the plugin never writes to a repository — not even `.git/index`. New git features must keep this promise; the README's privacy section lists every command.
- **Layers.** `git/` runs and parses git, `services/` holds state and change detection, and `ui/` renders. Parsers are pure functions so they can be tested without git.
- **Components own their cleanup.** Every renderer and sidebar section is an Obsidian `Component`; swapping what is shown tears down the previous editor, DOM and listeners. Register listeners with `registerDomEvent`, `registerEvent` or `register`.
- **Latest request wins.** Async loads go through a `LatestRequest` token (`utils/latest.ts`), so a slow load can never replace a newer selection.
- **Bounded work.** File sizes, search results, history and file indexes are capped, and watchers poll only while the view is visible.

`AGENTS.md` sums up these conventions for coding agents, together with Obsidian API and git pitfalls that are easy to hit — worth a read for human contributors too.

## Pull requests

- Keep each pull request focused on one change, and describe what it does and how you tested it.
- Make sure `npm run build`, `npm run lint` and `npm test` pass.
- Update the README when you add a feature users should know about, and its privacy section if you run a new git command. Keep it short.
- UI text uses sentence case and Obsidian's style: "select" rather than "click", and **bold** for labels.
- Don't commit build output (`main.js`) or `node_modules/`.

## Releasing

Maintainers release from `master`:

1. Run `npm version minor` (or `patch`/`major`). This updates `package.json`, `manifest.json` and `versions.json`, commits, and creates a tag without a `v` prefix.
2. Push the commit and the tag: `git push && git push --tags`.
3. The release workflow builds the plugin and creates a **draft** GitHub release with `main.js`, `manifest.json` and `styles.css`. Add release notes and publish it; Obsidian picks up the new version from there.

If a release needs a newer Obsidian API, raise `minAppVersion` in `manifest.json` before running `npm version`.
