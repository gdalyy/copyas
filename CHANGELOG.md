# Changelog

## 0.2.0 — 2026-10-06

- The clipboard owner detaches from the session: a copy survives closing Claude Code
  or reloading the plugin, and the owner exits when another app copies.
- A failing command answers with a one-line reason instead of a skipped hook.
- A missing clipboard tool is probed again on the next run, not cached for the session.
- Setting: save a copy under `~/.claude/copyas` on/off.
- Manifest metadata (display name, homepage, repository, license, keywords), LICENSE,
  CHANGELOG; `/copyas version` reads the manifest.

## 0.1.1 — 2026-10-06

- Rich text (`text/html`) on the clipboard for Slack, Teams, Jira, email and documents,
  through a GTK 4 helper, `wl-copy`, `xclip` or `osascript`; text form as the fallback.
- New destinations: Teams, Discord, WhatsApp, Telegram, email, docs, raw.
- Slack HTML tuned to its composer: blank lines between blocks, no merged code blocks,
  nested lists as indented glyph lines.
- `N` picks an earlier reply; `text` forces the text form.
- Fixed: a code span inside bold was dropped; an unmatched backtick run swallowed the
  line; an escaped backtick opened a code span.
- Settings: default destination, rich clipboard on/off, save a copy on/off.

## 0.1.0 — 2026-10-06

- `/copyas` with Slack mrkdwn, Jira wiki markup, Markdown, plain text and HTML source.
