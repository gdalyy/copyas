import type { EngineInterface, Register } from 'claude-code'

import { FORMAT_EXT, FORMAT_HELP, FORMAT_LABEL, FORMAT_TEXT_LABEL, convertAll, resolveFormat } from './format'
import type { Format } from './format'

const COMMAND = 'copyas'

// ---- rich clipboard: text/html beside text/plain, through a host tool.
// `$.ui.copy` carries text only; a destination that renders pasted HTML
// (Slack, Jira Cloud, Gmail, Outlook, Google Docs, Notion) goes through here.
// (Kept in this file: the validator follows `$` only within one module.)

type RichBackend = 'gtk' | 'wl-copy' | 'xclip' | 'osascript'

type RichResult = { isCopied: true; backend: RichBackend } | { isCopied: false; reason: string }

type Probe = { backend: RichBackend; argv: readonly string[] }

let probed: Promise<Probe | undefined> | undefined

async function has($: EngineInterface, argv: readonly string[]): Promise<boolean> {
  try {
    const ran = await $.process.run(argv, { timeoutMs: 8000 })
    return ran.exitCode === 0
  } catch {
    return false
  }
}

/** Finds a tool on this machine that can own the clipboard with HTML; cached per load. */
function probeRichBackend($: EngineInterface): Promise<Probe | undefined> {
  probed ??= (async () => {
    const uname = await $.process.run(['uname', '-s'], { timeoutMs: 5000 }).catch(() => undefined)
    const os = uname?.stdout.trim() ?? ''
    if (os === 'Darwin') return { backend: 'osascript', argv: ['osascript'] }
    if (os === 'Linux') {
      const helper = `${$.plugin.root}/bin/clip.py`
      // GTK 4 through PyGObject serves text/html and text/plain together
      if (await has($, ['python3', '-c', 'import gi; gi.require_version("Gdk", "4.0"); gi.require_version("Gtk", "4.0"); from gi.repository import Gdk, Gtk']))
        return { backend: 'gtk', argv: ['python3', helper] }
      if ((await $.env.get('WAYLAND_DISPLAY')) && (await has($, ['which', 'wl-copy'])))
        return { backend: 'wl-copy', argv: ['wl-copy', '--type', 'text/html'] }
      if (await has($, ['which', 'xclip']))
        return { backend: 'xclip', argv: ['xclip', '-selection', 'clipboard', '-t', 'text/html'] }
    }
    return undefined
  })()
  // a miss is not cached: a tool installed later is found on the next run
  return probed.then(found => {
    if (!found) probed = undefined
    return found
  })
}

/**
 * Puts `html` on the clipboard as text/html (and `text` as the plain target
 * where the tool can serve both). The owning process stays alive in the
 * background until another application takes the clipboard.
 */
async function copyRich($: EngineInterface, html: string, text: string): Promise<RichResult> {
  const probe = await probeRichBackend($)
  if (!probe) return { isCopied: false, reason: 'no rich clipboard tool on this machine' }

  if (probe.backend === 'osascript') {
    const hex = Array.from(new TextEncoder().encode(html), b => b.toString(16).padStart(2, '0')).join('')
    const ran = await $.process
      .run(['osascript', '-e', `set the clipboard to «data HTML${hex}»`], { timeoutMs: 10000 })
      .catch(() => undefined)
    return ran?.exitCode === 0
      ? { isCopied: true, backend: 'osascript' }
      : { isCopied: false, reason: `osascript failed: ${ran?.stderr.trim() || 'could not start'}` }
  }

  const input = probe.backend === 'gtk' ? JSON.stringify({ html, text }) : html
  // each tool detaches an owner of its own (the helper forks; wl-copy and xclip
  // daemonize), so the clipboard outlives this session and a plugin reload
  const child = $.process.spawn({ argv: probe.argv, input })

  return new Promise<RichResult>(resolve => {
    let settled = false
    const settle = (r: RichResult) => {
      if (!settled) {
        settled = true
        resolve(r)
      }
    }
    let stderr = ''
    // the loop ends when the tool has handed the clipboard to its detached owner
    void (async () => {
      try {
        for await (const chunk of child) {
          if (chunk.stream === 'stdout' && chunk.text.includes('ready')) settle({ isCopied: true, backend: probe.backend })
          if (chunk.stream === 'stderr') stderr += chunk.text
        }
      } catch (err) {
        stderr += err instanceof Error ? err.message : String(err)
      }
      settle({ isCopied: false, reason: `${probe.backend} ended before taking the clipboard${stderr ? `: ${stderr.trim()}` : ''}` })
    })()
    // wl-copy and xclip say nothing when they succeed: alive after a moment means owned
    if (probe.backend !== 'gtk') {
      void $.clock.sleep(600).then(() => settle({ isCopied: true, backend: probe.backend }))
    }
  })
}


const USAGE = [
  'Usage: /copyas [destination] [N] [turn] [text]',
  '',
  ...FORMAT_HELP,
  '',
  'N copies the Nth most recent reply (2 = the one before the last).',
  '"turn" copies every reply of that turn, not only the final one.',
  '"text" skips the rich clipboard and copies the text form only.',
  'The result is also saved to ~/.claude/copyas/last.<ext>.',
  'Rich text (Slack, Teams, Jira, email, docs) needs a clipboard tool: on Debian/Ubuntu',
  '  sudo apt install python3-gi gir1.2-gtk-4.0   (or wl-clipboard / xclip)',
].join('\n')

type Picked = { text: string; count: number }

type Message = { role: 'user' | 'assistant'; text: string; toolResults?: unknown[] }

/**
 * Which reply to copy: the `nth` most recent reply with text (1 = the latest),
 * or with `wholeTurn` every reply of the turn that reply belongs to.
 */
export function pickText(messages: readonly Message[], wholeTurn: boolean, nth = 1): Picked | undefined {
  // replies with text, newest first, each with the index of its turn's prompt
  const replies: { text: string; turn: number }[] = []
  let turn = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m) continue
    if (m.role === 'user') {
      // a user message carrying tool results is the engine's, not the person's prompt
      if (!(m.toolResults && m.toolResults.length)) turn--
      continue
    }
    if (m.text.trim() !== '') replies.push({ text: m.text.trim(), turn })
  }
  const target = replies[nth - 1]
  if (!target) return undefined
  const chosen = wholeTurn ? replies.filter(r => r.turn === target.turn) : [target]
  return { text: chosen.map(r => r.text).reverse().join('\n\n'), count: chosen.length }
}

export const register: Register = (on, options) => {
  const configured = resolveFormat(String(options.default_format ?? '')) ?? 'slack'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Copy the last reply to the clipboard for Slack, Teams, Discord, WhatsApp, Telegram, Jira, email, docs, Markdown, plain text or HTML',
      argumentHint: '[slack|teams|discord|whatsapp|telegram|jira|email|docs|md|raw|plain|html] [N] [turn] [text]',
    })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const words = e.args.trim().split(/\s+/).filter(Boolean)
    if (words.some(w => /^(help|formats|\?)$/i.test(w))) return { text: USAGE }
    if (words.some(w => /^version$/i.test(w))) {
      const manifest = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).catch(() => '{}')
      const version = /"version"\s*:\s*"([^"]+)"/.exec(manifest)?.[1] ?? 'unknown'
      return { text: `copyas ${version}` }
    }

    let format: Format = configured
    let wholeTurn = false
    let textOnly = options.rich === false
    let nth = 1
    for (const w of words) {
      const f = resolveFormat(w)
      if (f) format = f
      else if (/^\d{1,3}$/.test(w) && Number(w) >= 1) nth = Number(w)
      else if (/^(turn|all)$/i.test(w)) wholeTurn = true
      else if (/^(text|--text)$/i.test(w)) textOnly = true
      else return { text: `Unknown option "${w}".\n\n${USAGE}` }
    }

    const messages = await $.session.messages()
    const picked = pickText(messages, wholeTurn, nth)
    if (!picked)
      return { text: nth > 1 ? `There is no reply ${nth} back in this session.` : 'Nothing to copy yet: no reply with text in this session.' }

    const out = convertAll(picked.text, format)
    const lines = out.text.split('\n').length
    const label = FORMAT_TEXT_LABEL[format]
    const richLabel = format === 'rich' ? 'rich text' : `rich text for ${FORMAT_LABEL[format]}`
    const which = nth === 1 ? 'last reply' : `reply ${nth} back`
    const what = wholeTurn ? `${picked.count} replies of ${nth === 1 ? 'the last turn' : `that turn`}` : which

    const home = options.save_copy === false ? undefined : await $.env.get('HOME')
    let saved: string | undefined
    if (home) {
      saved = `${home}/.claude/copyas/last.${FORMAT_EXT[format]}`
      try {
        await $.fs.write(saved, out.text)
        if (out.html) await $.fs.write(`${home}/.claude/copyas/last.html`, out.html)
      } catch {
        saved = undefined
      }
    }
    const savedNote = saved ? ` Also saved to ${saved}` : ''

    // rich text first, where the destination renders pasted HTML and a tool can carry it
    let richNote = ''
    if (out.html && !textOnly) {
      const rich = await copyRich($, out.html, out.text)
      if (rich.isCopied) {
        $.ui.toast(`Copied ${what} as ${richLabel}`)
        return { text: `Copied ${what} as ${richLabel} (${lines} lines, via ${rich.backend}).${savedNote}` }
      }
      richNote =
        format === 'slack'
          ? ` Rich paste unavailable (${rich.reason}); copied mrkdwn text instead, which Slack renders only with "Format messages with markup" on. Run /copyas help for the fix.`
          : ` Rich paste unavailable (${rich.reason}); copied the text form instead.`
    }

    const copied = await $.ui.copy({ text: out.text })
    if (copied.isCopied) {
      $.ui.toast(`Copied ${what} as ${label}`)
      return { text: `Copied ${what} as ${label} (${lines} lines).${richNote}${savedNote}` }
    }
    const why =
      copied.reason === 'no-clipboard'
        ? 'the terminal took no clipboard write (install xclip or wl-clipboard, or use a terminal with OSC 52 support)'
        : copied.reason === 'no-surface'
          ? 'no terminal is attached'
          : 'another plugin refused the copy'
    return {
      text: `Could not copy: ${why}.${saved ? ` The ${label} text is saved at ${saved}` : ''}`,
    }
  }).catch(($, e, next) => {
    const why = next.error.kind === 'timeout' ? 'it took too long' : (next.error.message ?? 'unknown error')
    $.ui.log(`copyas: /copyas failed: ${why}`, { to: 'debug' })
    return { text: `copyas could not copy: ${why}. The last text form, if any, is under ~/.claude/copyas/.` }
  })
}
