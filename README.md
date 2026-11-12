# Source Observer

An Obsidian plugin for browsing local code: open any folder, read files with syntax highlighting, and review git changes. Read-only and offline.

![Source Observer](docs/images/hero.png)

## Features

- File tree with git status, syntax highlighting, find in file and go to line
- Changes grouped into conflicts, staged and unstaged, with unified or side-by-side diffs
- Changes against a base branch: everything a branch or worktree changed since it branched off, committed or not (toggle in the **Changes** header)
- Search in files (`git grep` in repositories)
- File history and blame
- Worktree switcher: select the branch name in **Changes**
- Links and live embeds of code in notes
- Copy code, references and diffs to paste into Claude Code or other coding agents

## Usage

Run **Source Observer: Open**, then select **Open folder…** at the top of the sidebar. All actions are also available as commands under **Source Observer:** in the command palette. In the viewer, <kbd>Mod</kbd>+<kbd>F</kbd> finds in the open file and <kbd>Mod</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> searches all files.

To reference code from a note, select lines and use the link icon in the viewer header: **Copy link**, **Copy embed** or **Copy as code block**. An embed looks like this:

````markdown
```source-observer
folder: /Users/me/code/my-project
file: src/server.ts
lines: 40-75
```
````

`file` can be relative to `folder` or absolute. `lines` is optional. Links and embeds use absolute paths, so they only work on the computer that made them.

To give code to a coding agent such as Claude Code, use the same menu:

- **Copy reference** copies `src/server.ts:40-75`. The agent then reads the file itself.
- **Copy for agent** copies the reference followed by the code.
- **Copy diff**, in a diff, copies the change as a unified diff. To copy a single change, select the copy icon next to it.

Paths are relative to the repository root, so they match an agent started there. In history, references name the commit, e.g. `src/server.ts:40-75 @ a1b2c3d`. Right-click search results to copy references to their lines, and use the copy icon in the **Changes** header to copy all changes as one diff or a list of changed files.

## Installation

Install from **Settings → Community plugins → Browse**, or copy `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/IceKhan13/obsidian-source-observer/releases/latest) to `<vault>/.obsidian/plugins/source-observer/`.

Requires desktop Obsidian 1.7.2+. Git features need `git` on your `PATH`.

## Privacy

Source Observer makes no network requests. It only runs read-only git commands (`status`, `ls-files`, `cat-file`, `grep`, `log`, `blame`, `diff`, `merge-base`, `rev-parse`, `rev-list`, `for-each-ref`, `symbolic-ref`, `worktree list`) with `--no-optional-locks`, so it never writes to your repository.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
