# Source Observer

A lightweight codebase viewer for [Obsidian](https://obsidian.md). Browse any folder on disk, read files with syntax highlighting, and review git changes — without leaving your vault.

![Source Observer](obsidian-plugin.png)

## Features

- **File tree** — navigate any folder with file-type icons; files and folders are coloured by git status, and folders containing changes are marked with a dot. The tree updates itself when files are created or deleted.
- **Syntax highlighting** — follows your Obsidian theme. Supports JS/TS, Python, Rust, Go, Ruby, Java, Kotlin, Scala, C/C++, C#, Swift, PHP, Lua, SQL, shell, CSS, HTML, Vue/Svelte, JSON, YAML, TOML, Markdown, Dockerfiles and more.
- **Git changes** — changed files grouped into **Merge conflicts**, **Staged** and **Changes**, with the current branch and ahead/behind counts.
- **Diffs** — syntax-highlighted, unified or side by side, with unchanged regions collapsed and `+added −removed` line counts. Staged diffs compare HEAD to the index; unstaged diffs compare the index to the working tree.
- **Find in file and go to line** — <kbd>Mod</kbd>+<kbd>F</kbd> opens a find bar with case, regexp and whole-word options; **Go to line** accepts `42`, `42:7`, `+10` or `50%`.
- **Live updates** — the change list, tree and open file refresh automatically when files or git state change.
- **Subfolders of a repository** — open any folder inside a repo; only changes within that folder are shown.
- **Search** — file-name search with exact and prefix matches ranked first (respects `.gitignore` in repositories; type a `/` to match paths) and a filter for changed files.
- **Search in files** — full-text search across the folder with **Match case**, **Match whole word** and **Use regular expression** options. Results are grouped by file with the matches highlighted; select one to open the file at that line. Uses `git grep` in repositories (so `.gitignore` is respected and binary files are skipped) and reads the files directly elsewhere.
- **File history** — the commits that changed the open file, newest first and following renames. Select a commit to see what it changed in the file.
- **Blame** — show who last changed each line, and when, in a gutter beside the code. Select an entry to see that commit's change.
- **Keyboard navigation** — arrow keys, Home/End, Enter, and Left/Right to collapse and expand folders.
- **Links to code** — copy a link to a file or the selected lines; opening it in a note jumps to the file in Source Observer with those lines highlighted.
- **Live code embeds** — embed a file or a range of lines in a note. The excerpt is syntax-highlighted, keeps its real line numbers, and updates when the file changes.
- **Copy as code block** — paste a static, fenced copy of the selection into a note, followed by a link back to the source.
- **Context menu** — right-click a file, folder or change to copy its path or relative path, reveal it in Finder or the system file manager, or open it in its default app.
- **Recent folders** and a resizable sidebar.
- **Safe with large and binary files** — files over 2 MB and binary files show a message instead of being loaded.

## Usage

1. Select the `</>` icon in the ribbon or run **Source Observer: Open** from the command palette.
2. Select the folder button at the top of the sidebar, then **Browse…**, **Enter path…**, or a recent folder. You can also run **Source Observer: Open folder…**.
3. Select a file in **Files** to view it, or a file in **Changes** to view its diff. In a diff, use the icons in the header to switch between unified and side-by-side layout, or to open the full file. The default layout is in **Settings → Source Observer → Diff layout**.
4. Press <kbd>Mod</kbd>+<kbd>F</kbd>, or select the search icon in the header, to find text in the open file or diff. Run **Source Observer: Go to line** to jump to a line; both commands can be given hotkeys in **Settings → Hotkeys**.
5. To reference code in a note, select lines in a file (or select nothing for the whole file), then select the link icon in the header and choose **Copy link**, **Copy embed** or **Copy as code block**, and paste into a note. The same actions are available as commands, and **Copy link** and **Copy embed** are in the right-click menu of every file.
6. To search file contents, press <kbd>Mod</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> in the viewer or run **Source Observer: Search in files**. Text selected on a single line is searched for straight away. Results update as you type; press <kbd>Enter</kbd> to search immediately.
7. To see the history of the open file, select the history icon in the header or run **Source Observer: Show file history**; the **History** section follows whichever file is open. Select the blame icon or run **Source Observer: Toggle blame** to show who last changed each line, and select an entry to open its commit.
8. Use the search icon in the **Files** and **Changes** headers to filter; press <kbd>Esc</kbd> to close the search.
9. Drag the border between the sidebar and the viewer to resize it; double-click to reset.

### Embeds

An embed is a code block with the `source-observer` language:

````markdown
```source-observer
folder: /Users/me/code/my-project
file: src/server.ts
lines: 40-75
```
````

- `file` is required. It is relative to `folder`, or an absolute path (`~` is expanded), in which case `folder` can be left out.
- `lines` is optional: a single line (`12`) or a range (`40-75`). Without it the whole file is embedded.
- Select the header of an embed to open the file in Source Observer at those lines.

Links have the form `obsidian://source-observer?folder=…&file=…&lines=…`. Both links and embeds use absolute paths, so they work on the computer they were created on.

## Privacy

Source Observer works entirely offline. It reads files from the folder you open and runs your local `git` executable (read-only commands such as `status`, `ls-files`, `cat-file`, `grep`, `log` and `blame`, with `--no-optional-locks` so it never writes to your repository). It makes no network requests and collects no data. Embeds read the files they name directly from disk, and opening an `obsidian://source-observer` link opens that folder in the viewer. **Reveal in Finder** and **Open in default app** hand the selected path to your operating system.

## Installation

1. Copy `main.js`, `styles.css`, and `manifest.json` into `<vault>/.obsidian/plugins/source-observer/`.
2. Enable the plugin in **Settings → Community plugins**.

The plugin is desktop-only because it reads the file system and runs `git`.

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # type-check and production build
npm run lint
npm test       # unit, git integration and DOM tests (vitest)
```

### Architecture

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
  services/
    RepoState.ts              single-flight status refresh with stale-result protection
    RepoWatcher.ts            watches the git dir and working tree; polls only while visible
    FileIndex.ts              cached file list for search (git ls-files or a bounded walk)
    ContentSearch.ts          search in files: git grep, or reading indexed files; match previews
  ui/
    SourceObserverView.ts     layout and wiring
    sidebar/                  Files, Search, Changes and History sections, tree, keyboard navigation
    pane/                     content pane and its renderers (code, diff, message)
    editor/                   CodeMirror theme, languages, diff stats, blame gutter
    embed/                    live code embeds rendered inside notes
    fileMenu.ts               right-click menu for files, folders and changes
  utils/                      file reading, icons, paths, request tokens, OS integration
```

Each renderer in the content pane is an Obsidian `Component`, so swapping what is shown always tears down the previous editor, DOM and listeners. All loads into the pane go through one "latest request wins" token, so a slow load can never replace a newer selection.

## License

MIT
