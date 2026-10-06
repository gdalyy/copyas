# copyas

A Claude Code plugin that copies Claude's last reply to the clipboard in a
format that pastes cleanly into Slack, Jira, email, GitHub, Notion and others.

Selecting text in the terminal copies the *rendered* output: a two-column
gutter in front of every line, hard wraps at the terminal width, bullet
glyphs and lost emphasis. `/copyas` reads the model's original Markdown from
the session transcript instead and converts it for the destination.

## Usage

```
/copyas                 last reply for Slack (the default)
/copyas <destination>   see the table below
/copyas slack 3         the reply three back (1 = the latest)
/copyas slack turn      every reply of the last turn, not only the final one
/copyas slack text      the text form only, skipping the rich clipboard
/copyas help            the destination list
```

| Destination | Also answers to | What goes on the clipboard |
|-------------|-----------------|----------------------------|
| `slack`     | `gchat`, `googlechat` | rich text tuned for Slack's composer; mrkdwn text as fallback |
| `teams`     | `msteams` | rich text (lists and tables included); Markdown as fallback |
| `discord`   |  | Discord Markdown: headings to h3, lists, fences with language |
| `whatsapp`  | `signal`, `imessage`, `wa` | `*bold*`, `_italic_`, `-` bullets, fences without language |
| `telegram`  | `tg` | `**bold**`, `__italic__`, glyph bullets, fences with language |
| `jira`      | `confluence`, `wiki` | rich text for Jira Cloud; wiki markup (`h2.`, `*`, `{code}`) for Jira Server |
| `email`     | `mail`, `gmail`, `outlook` | rich text; plain text as fallback |
| `docs`      | `gdocs`, `word`, `notion`, `coda`, `rich` | rich text; plain text as fallback |
| `md`        | `github`, `gitlab`, `linear`, `obsidian`, `mattermost`, ... | clean Markdown, pipes tables |
| `raw`       |  | the reply exactly as written |
| `plain`     | `txt`, `sms` | no markup at all |
| `html`      |  | HTML source, as text |

The text form is also written to `~/.claude/copyas/last.<ext>` (and the HTML
to `last.html`), so when no clipboard path works you still have the file.

Change the default destination, or switch the rich clipboard off, in `/config`.

## How the clipboard is filled

Slack's message box, Teams, Jira Cloud's editor, Gmail, Outlook, Google Docs
and Notion all render **pasted rich text** (the `text/html` clipboard target)
but show pasted *markup* literally: `*bold*` pasted into Slack stays `*bold*`
unless the "Format messages with markup" preference is on. So for those
destinations the plugin puts HTML on the clipboard, with the text form as the
plain-text target for applications that only read text. Discord, WhatsApp and
Telegram are text-only composers that apply their own markup on send, so they
get text.

Claude Code's own clipboard write carries text only, so the HTML goes through
a small helper per platform, shipped in `bin/`:

| Platform | How | Targets | Tested |
|----------|-----|---------|--------|
| Linux (X11, Wayland) | `python3` + PyGObject + GTK 4 (`bin/clip.py`) | text/html + text/plain | yes |
| Linux, no GTK bindings | `wl-copy` (Wayland) or `xclip` (X11) | text/html only | yes |
| macOS | `osascript -l JavaScript` (`bin/clip.jxa.js`), no install | HTML + plain text | not yet |
| Windows | Windows PowerShell 5.1 (`bin/clip.ps1`), no install | CF_HTML + Unicode text | not yet |
| WSL | `powershell.exe` from inside WSL, paths via `wslpath` | CF_HTML + Unicode text | not yet |

On X11 and Wayland the clipboard lives in the process that owns it, so the
Linux helper leaves a small detached owner behind. It exits by itself as soon
as another application copies something, and it survives the Claude Code
session that made it. macOS and Windows keep clipboard content in the system,
so their helpers simply exit.

When no helper works the text form is copied through Claude Code's normal
path (`pbcopy`, `clip.exe`, `xclip`, `wl-copy`, else the OSC 52 terminal
escape) and the command says why. That path works on every platform, so the
plugin always copies something. On Debian/Ubuntu, `sudo apt install python3-gi
gir1.2-gtk-4.0` gives the best Linux path; `wl-clipboard` or `xclip` are the
lighter alternatives.

Slack's paste handler is the pickiest: the Slack HTML form writes headings as
bold paragraphs, tables as preformatted text, nested lists as indented glyph
lines, and separates blocks with an empty line so code blocks do not merge.

## What each format does

| Markdown               | slack (text form)      | jira (text form)     | plain          |
|------------------------|------------------------|----------------------|----------------|
| `## Heading`           | `*Heading*`            | `h2. Heading`        | `Heading`      |
| `**bold**` / `*it*`    | `*bold*` / `_it_`      | `*bold*` / `_it_`    | `bold` / `it`  |
| `` `code` ``           | `` `code` ``           | `{{code}}`           | `code`         |
| ```` ```lang ````      | ```` ``` ```` (no lang)| `{code:lang}`        | 4-space indent |
| `- item` / nested      | `• item` / `    ◦ sub` | `* item` / `** sub`  | `- item`       |
| `1. step`              | `1. step`              | `# step`             | `1. step`      |
| `[text](url)`          | `text (url)`           | `[text\|url]`        | `text (url)`   |
| table                  | aligned, in ``` block  | `\|\|h\|\|` table    | aligned text   |
| `> quote`              | `> quote`              | `{quote}`            | `> quote`      |

The Slack HTML form writes headings as bold paragraphs and tables as
preformatted text, since Slack has neither.

## Install

In a terminal session of Claude Code:

```
/plugin install copyas --marketplace gdalyy/copyas
```

Answer `y` to add the marketplace, then pick a scope (user scope makes it
available in every project). Updates arrive with `claude plugin update copyas`.

To run it from a local checkout instead: `claude --plugin-dir /path/to/copyas`,
or add the folder as a marketplace and install from it:

```
claude plugin marketplace add /path/to/copyas
claude plugin install copyas@copyas
```

A plugin installed from a local folder runs from that folder directly: edit
it, then `/reload-plugins` in a running session.

Both the GitHub marketplace and a local checkout register under the name
`copyas`, so Claude Code refuses to add the second one ("its source doesn't
match its extraKnownMarketplaces entry"). To switch from one to the other,
remove the existing marketplace first:

```
claude plugin marketplace remove copyas
```

## Development

```
claude plugin validate .   # manifest + hooks module
claude plugin test .       # hooks/format.test.ts
```

`hooks/format.ts` is the pure Markdown → format converter; `hooks/register.ts`
registers the `/copyas` command and talks to the engine.
