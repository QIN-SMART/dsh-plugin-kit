# __PKG__

__DESC_EN__

[中文说明](README.md) · no runtime dependencies · self test needs nothing but Node

![verify](https://github.com/__AUTHOR__/__PKG__/actions/workflows/verify.yml/badge.svg)

## Install

```sh
# from GitHub (recommended)
dsh plugin --profile web add github:__AUTHOR__/__PKG__

# from npm, once published
dsh plugin --profile web add __PKG__
```

Then reload the browser page.

## Usage

| Entry point | Action |
|---|---|
| Row menu | Hover a conversation row → **…** → **Mark** |
| Keyboard | `⌘⇧S` (Windows/Linux `Ctrl+Shift+S`) toggles the conversation you are viewing |
| Mouse | Right-click any conversation row |

## How it works

- Marking is a **row-level attribute** (`[data-row-key^="session:"]` plus an injected stylesheet), so no CSS-module hashed class name is ever referenced.
- The dot in front of the title uses the official `sidebar.session.row.leading` slot; that cell is not rendered for running/archived conversations, which is why the durable information lives on the row.
- State lives in `localStorage['__PKG__.v1']` and syncs across tabs through the `storage` event.

## Verify

```sh
node --test test/verify.mjs
```

## License

MIT — see [LICENSE](LICENSE).
