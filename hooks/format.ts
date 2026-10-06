// Pure Markdown -> destination conversion. No engine access: testable alone.

/**
 * A destination. Each has a text form (the plain-text clipboard target, and
 * the only form where no rich clipboard is available) and, where the
 * destination renders pasted rich text, an HTML form.
 */
export type Format =
  | 'slack'
  | 'teams'
  | 'discord'
  | 'whatsapp'
  | 'telegram'
  | 'jira'
  | 'rich'
  | 'md'
  | 'raw'
  | 'plain'
  | 'html'

export const FORMATS: readonly Format[] = [
  'slack',
  'teams',
  'discord',
  'whatsapp',
  'telegram',
  'jira',
  'rich',
  'md',
  'raw',
  'plain',
  'html',
]

/** The destination, for "copied as rich text for <label>". */
export const FORMAT_LABEL: Record<Format, string> = {
  slack: 'Slack',
  teams: 'Microsoft Teams',
  discord: 'Discord',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  jira: 'Jira',
  rich: 'email and documents',
  md: 'Markdown',
  raw: 'raw Markdown',
  plain: 'plain text',
  html: 'HTML source',
}

/** The text form, for "copied as <label>" when only text was copied. */
export const FORMAT_TEXT_LABEL: Record<Format, string> = {
  slack: 'Slack mrkdwn text',
  teams: 'Markdown text',
  discord: 'Discord markdown',
  whatsapp: 'WhatsApp text',
  telegram: 'Telegram text',
  jira: 'Jira wiki markup',
  rich: 'plain text',
  md: 'Markdown',
  raw: 'raw Markdown',
  plain: 'plain text',
  html: 'HTML source',
}

export const FORMAT_EXT: Record<Format, string> = {
  slack: 'slack.txt',
  teams: 'teams.md',
  discord: 'discord.md',
  whatsapp: 'whatsapp.txt',
  telegram: 'telegram.txt',
  jira: 'jira.txt',
  rich: 'txt',
  md: 'md',
  raw: 'raw.md',
  plain: 'txt',
  html: 'html',
}

/** Help text: one line per destination, aliases included. */
export const FORMAT_HELP: readonly string[] = [
  'Chat',
  '  slack      Slack (also: gchat, googlechat)',
  '  teams      Microsoft Teams',
  '  discord    Discord',
  '  whatsapp   WhatsApp (also: signal, imessage)',
  '  telegram   Telegram',
  'Tickets, mail and documents (rich text)',
  '  jira       Jira Cloud and Jira Server, Confluence (also: confluence, wiki)',
  '  email      Gmail, Outlook, Apple Mail (also: mail, gmail, outlook)',
  '  docs       Google Docs, Word, Notion, Coda (also: gdocs, word, notion, rich)',
  'Markdown and text',
  '  md         GitHub, GitLab, Linear, Obsidian, Mattermost (also: github, gitlab, ...)',
  '  raw        the reply exactly as written, untouched Markdown',
  '  plain      no markup at all: SMS, commit messages, forms (also: txt)',
  '  html       HTML source as text: email templates, CMS source editors',
]

const ALIASES: Record<string, Format> = {
  slack: 'slack',
  gchat: 'slack',
  googlechat: 'slack',
  teams: 'teams',
  msteams: 'teams',
  discord: 'discord',
  whatsapp: 'whatsapp',
  wa: 'whatsapp',
  signal: 'whatsapp',
  imessage: 'whatsapp',
  telegram: 'telegram',
  tg: 'telegram',
  jira: 'jira',
  confluence: 'jira',
  wiki: 'jira',
  rich: 'rich',
  email: 'rich',
  mail: 'rich',
  gmail: 'rich',
  outlook: 'rich',
  docs: 'rich',
  gdocs: 'rich',
  word: 'rich',
  notion: 'rich',
  coda: 'rich',
  md: 'md',
  markdown: 'md',
  github: 'md',
  gitlab: 'md',
  bitbucket: 'md',
  linear: 'md',
  obsidian: 'md',
  mattermost: 'md',
  zulip: 'md',
  reddit: 'md',
  discourse: 'md',
  raw: 'raw',
  plain: 'plain',
  txt: 'plain',
  sms: 'plain',
  html: 'html',
}

export function resolveFormat(word: string | undefined): Format | undefined {
  if (!word) return undefined
  return ALIASES[word.toLowerCase().replace(/^--/, '')]
}

// ---------------------------------------------------------------- blocks

type ListItem = { ordered: boolean; number: string; depth: number; text: string }

type Block =
  | { kind: 'code'; lang: string; lines: string[] }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'list'; items: ListItem[] }
  | { kind: 'quote'; text: string }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'rule' }

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)\s*$/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/
const ITEM = /^(\s*)(?:([-*+])|(\d{1,3})[.)])\s+(.*)$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/

function isTableRow(line: string): boolean {
  return line.includes('|') && line.trim() !== ''
}

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))
}

export function parse(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const at = (k: number): string => lines[k] ?? ''
  const indentOf = (l: string): number => (/^\s*/.exec(l)?.[0] ?? '').replace(/\t/g, '    ').length
  const isFenceClose = (l: string, mark: string): boolean => {
    const t = l.trim()
    return t.startsWith(mark) && t.replace(/[`~]/g, '') === ''
  }
  const blocks: Block[] = []
  let i = 0

  // list state
  let list: ListItem[] | undefined
  let stack: number[] = [] // indent width per depth

  const closeList = () => {
    if (list && list.length) blocks.push({ kind: 'list', items: list })
    list = undefined
    stack = []
  }
  const lastItem = (): ListItem | undefined => (list ? list[list.length - 1] : undefined)

  let para: string[] = []
  const closePara = () => {
    if (para.length) blocks.push({ kind: 'para', text: joinSoft(para) })
    para = []
  }

  while (i < lines.length) {
    const line = at(i)

    // fenced code
    const fence = FENCE.exec(line)
    if (fence) {
      const mark = (fence[1] ?? '```').slice(0, 3)
      const lang = fence[2] ?? ''
      const body: string[] = []
      i++
      while (i < lines.length && !isFenceClose(at(i), mark)) {
        body.push(at(i))
        i++
      }
      i++ // the closing fence, or past the end
      const item = lastItem()
      if (item) {
        // a fence inside a list item stays with the item, as literal lines
        item.text += '\n' + [line.trim(), ...body.map(l => l.trim()), mark].join('\n')
      } else {
        closePara()
        blocks.push({ kind: 'code', lang, lines: dedent(body) })
      }
      continue
    }

    if (line.trim() === '') {
      closePara()
      // a blank keeps a list open only when the next non-blank line belongs to it
      if (list) {
        let j = i + 1
        while (j < lines.length && at(j).trim() === '') j++
        const nextLine = at(j)
        const continues = j < lines.length && (ITEM.test(nextLine) || /^\s{2,}\S/.test(nextLine))
        if (!continues) closeList()
      }
      i++
      continue
    }

    const item = ITEM.exec(line)
    const number = item?.[3]
    // only a bullet or a `1.` item may interrupt a paragraph (so `2024. text` stays prose)
    if (item && !(para.length && !list && number !== undefined && number !== '1')) {
      closePara()
      const indent = indentOf(line)
      const ordered = number !== undefined
      // a switch between bullets and numbers at the top level starts a new list
      if (list && list[0] && indent <= (stack[0] ?? 0) && ordered !== list[0].ordered) closeList()
      if (!list) {
        list = []
        stack = [indent]
      } else {
        while (stack.length > 1 && indent < (stack[stack.length - 1] ?? 0)) stack.pop()
        if (indent > (stack[stack.length - 1] ?? 0)) stack.push(indent)
      }
      list.push({ ordered, number: number ?? '', depth: stack.length - 1, text: item[4] ?? '' })
      i++
      continue
    }

    const current = lastItem()
    if (current) {
      // continuation of the current item: indented text, or a lazy (unindented) line
      const startsBlock =
        HEADING.test(line) ||
        RULE.test(line) ||
        QUOTE.test(line) ||
        (isTableRow(line) && i + 1 < lines.length && TABLE_SEP.test(at(i + 1)))
      if (indentOf(line) >= 2 || !startsBlock) {
        current.text += '\n' + line.trim()
        i++
        continue
      }
      closeList()
    }

    const heading = HEADING.exec(line)
    if (heading) {
      closePara()
      blocks.push({ kind: 'heading', level: (heading[1] ?? '#').length, text: heading[2] ?? '' })
      i++
      continue
    }

    if (RULE.test(line)) {
      closePara()
      blocks.push({ kind: 'rule' })
      i++
      continue
    }

    if (QUOTE.test(line)) {
      closePara()
      const q: string[] = []
      while (i < lines.length && QUOTE.test(at(i))) {
        q.push(QUOTE.exec(at(i))?.[1] ?? '')
        i++
      }
      blocks.push({ kind: 'quote', text: joinSoft(q) })
      continue
    }

    if (isTableRow(line) && i + 1 < lines.length && TABLE_SEP.test(at(i + 1)) && at(i + 1).includes('|')) {
      closePara()
      const header = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isTableRow(at(i)) && !ITEM.test(at(i))) {
        rows.push(splitRow(at(i)))
        i++
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }

    para.push(line)
    i++
  }
  closePara()
  closeList()
  return blocks
}

function joinSoft(lines: string[]): string {
  // join soft-wrapped lines with a space; keep hard breaks (two trailing spaces or backslash)
  let out = ''
  for (let k = 0; k < lines.length; k++) {
    const raw = lines[k] ?? ''
    const hard = /( {2,}|\\)$/.test(raw)
    const text = raw.trim()
    if (k === 0) out = text
    else out += (/\n$/.test(out) ? '' : ' ') + text
    if (hard && k < lines.length - 1) out += '\n'
  }
  return out
}

function dedent(lines: string[]): string[] {
  const lead = (l: string) => (/^\s*/.exec(l)?.[0] ?? '').length
  const indents = lines.filter(l => l.trim() !== '').map(lead)
  const min = indents.length ? Math.min(...indents) : 0
  const out = lines.map(l => l.slice(Math.min(min, lead(l))).replace(/\s+$/, ''))
  while (out.length && out[out.length - 1] === '') out.pop()
  while (out.length && out[0] === '') out.shift()
  return out
}

// ---------------------------------------------------------------- inline

type InlineStyle = {
  bold: (s: string) => string
  italic: (s: string) => string
  strike: (s: string) => string
  code: (s: string) => string
  link: (text: string, url: string) => string
  text: (s: string) => string // escaping of literal text
}

const LINK = /!?\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g
const BOLD = /\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__/g
const ITALIC = /(?<![\w*\\])\*(?=\S)([^*\n]*?\S)\*(?![\w*])|(?<![\w_\\])_(?=\S)([^_\n]*?\S)_(?![\w_])/g
const STRIKE = /~~(?=\S)([\s\S]*?\S)~~/g

type Stores = { codes: string[]; links: string[]; styled: string[] }

export function inline(src: string, style: InlineStyle): string {
  const stores: Stores = { codes: [], links: [], styled: [] }
  const s = inlineInner(src, style, stores)
  return restore(s, style, stores)
}

function restore(s: string, style: InlineStyle, stores: Stores): string {
  // styled runs may hold placeholders of their own, so restore until none is left
  let out = s
  for (let guard = 0; guard < 8 && /[\u0000\u0001\u0002]/.test(out); guard++) {
    out = out
      .replace(/\u0002(\d+)\u0002/g, (_m, n: string) => stores.styled[Number(n)] ?? '')
      .replace(/\u0001(\d+)\u0001/g, (_m, n: string) => stores.links[Number(n)] ?? '')
      .replace(/\u0000(\d+)\u0000/g, (_m, n: string) => style.code(stores.codes[Number(n)] ?? ''))
  }
  return out
}

function inlineInner(src: string, style: InlineStyle, stores: Stores): string {
  // 0. a backslash-escaped backtick is a literal backtick, never a code span
  src = src.replace(/\\`/g, '\u0003')
  // 1. protect code spans
  // a backtick run closes only on a run of the same length; an unmatched run (``` in prose) stays literal
  let s = src.replace(/(?<!`)(`+)(?!`)([\s\S]*?)(?<!`)\1(?!`)/g, (_m, _t, body: string) => {
    stores.codes.push(body.replace(/^ (.*) $/, '$1').replace(/\u0003/g, '`'))
    return `\u0000${stores.codes.length - 1}\u0000`
  })
  // 2. links (the text inside is still raw markdown; style it, but never as a link again)
  const noLink: InlineStyle = { ...style, link: (t: string) => t }
  s = s.replace(LINK, (_m, text: string, url: string) => {
    stores.links.push(style.link(inlineInner(text, noLink, stores), url))
    return `\u0001${stores.links.length - 1}\u0001`
  })
  // 3. bare URLs in angle brackets
  s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (_m, url: string) => {
    stores.links.push(style.link(url, url))
    return `\u0001${stores.links.length - 1}\u0001`
  })
  // 4. emphasis: each styled run becomes a placeholder so a later pass cannot re-match it
  const keep = (run: string) => {
    stores.styled.push(run)
    return `\u0002${stores.styled.length - 1}\u0002`
  }
  s = s.replace(BOLD, (_m, a: string, b: string) => keep(style.bold(inlineInner(a ?? b, style, stores))))
  s = s.replace(STRIKE, (_m, a: string) => keep(style.strike(inlineInner(a, style, stores))))
  s = s.replace(ITALIC, (_m, a: string, b: string) => keep(style.italic(inlineInner(a ?? b, style, stores))))
  // 5. escape the literal remainder (placeholders carry no escapable characters)
  return style.text(unescapeMd(s).replace(/\u0003/g, '`'))
}

function unescapeMd(s: string): string {
  return s.replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1')
}

const plainStyle: InlineStyle = {
  bold: s => s,
  italic: s => s,
  strike: s => s,
  code: s => s,
  link: (t, u) => (t === u || t === '' ? u : `${t} (${u})`),
  text: s => s,
}

// Slack, Google Chat: *bold* _italic_ ~strike~; <url|text> works only through
// the API, not pasted into the composer, so links are written as "text (url)"
const slackStyle: InlineStyle = {
  bold: s => `*${s}*`,
  italic: s => `_${s}_`,
  strike: s => `~${s}~`,
  code: s => `\`${s}\``,
  link: (t, u) => (t === u || t === '' ? u : `${t} (${u})`),
  text: s => s,
}

// WhatsApp, Signal: the same marks as Slack
const whatsappStyle: InlineStyle = slackStyle

// Telegram applies **bold** __italic__ ~~strike~~ `code` on send
const telegramStyle: InlineStyle = {
  bold: s => `**${s}**`,
  italic: s => `__${s}__`,
  strike: s => `~~${s}~~`,
  code: s => `\`${s}\``,
  link: (t, u) => (t === u || t === '' ? u : `${t} (${u})`),
  text: s => s,
}

const jiraStyle: InlineStyle = {
  bold: s => `*${s}*`,
  italic: s => `_${s}_`,
  strike: s => `-${s}-`,
  code: s => `{{${s}}}`,
  link: (t, u) => (t === u || t === '' ? `[${u}]` : `[${t}|${u}]`),
  text: s => s.replace(/([{[])/g, '\\$1'),
}

const mdStyle: InlineStyle = {
  bold: s => `**${s}**`,
  italic: s => `*${s}*`,
  strike: s => `~~${s}~~`,
  code: s => (s.includes('`') ? `\`\` ${s} \`\`` : `\`${s}\``),
  link: (t, u) => (t === u || t === '' ? `<${u}>` : `[${t}](${u})`),
  text: s => s.replace(/([*_`[\]\\])/g, '\\$1'),
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const htmlStyle: InlineStyle = {
  bold: s => `<strong>${s}</strong>`,
  italic: s => `<em>${s}</em>`,
  strike: s => `<del>${s}</del>`,
  code: s => `<code>${escapeHtml(s)}</code>`,
  link: (t, u) => `<a href="${escapeHtml(u)}">${t === '' ? escapeHtml(u) : t}</a>`,
  text: escapeHtml,
}

// ---------------------------------------------------------------- tables

function alignedTable(header: string[], rows: string[][], map: (s: string) => string): string[] {
  const all = [header, ...rows].map(r => r.map(map))
  const width = Math.max(...all.map(r => r.length))
  const cols = Array.from({ length: width }, (_, c) => Math.max(...all.map(r => (r[c] ?? '').length)))
  const line = (r: string[]) => cols.map((w, c) => (r[c] ?? '').padEnd(w)).join(' | ').replace(/\s+$/, '')
  return [line(all[0] ?? []), cols.map(w => '-'.repeat(w)).join('-|-'), ...all.slice(1).map(line)]
}

// ---------------------------------------------------------------- text dialects

/**
 * How one text destination writes each block. Lists come as a flat list of
 * items with a depth; `bullet` and `number` give the marker for a depth, and
 * `indent` the prefix before it.
 */
type Dialect = {
  style: InlineStyle
  /** Keep inline text as written (the destination reads Markdown itself). */
  verbatim?: boolean
  heading: (level: number, text: string) => string
  bullet: (depth: number) => string
  number: (n: string, depth: number) => string
  indent: (depth: number) => string
  /** The fence; `lang` may be dropped where the destination ignores it. */
  code: (lang: string, body: string) => string
  quote: (text: string) => string
  /** A horizontal rule, or undefined to leave it out. */
  rule: string | undefined
  /** Tables: in a code block, aligned bare, or in Markdown pipes. */
  table: 'code' | 'aligned' | 'pipes'
}

const ink = (text: string, d: Dialect) => (d.verbatim ? text : inline(text, d.style))

function renderList(items: ListItem[], d: Dialect): string {
  const counters: number[] = []
  return items
    .map(it => {
      counters.length = it.depth + 1
      counters[it.depth] = (counters[it.depth] ?? 0) + 1
      const pad = d.indent(it.depth)
      const mark = it.ordered ? d.number(it.number || String(counters[it.depth]), it.depth) : d.bullet(it.depth)
      const hang = pad + ' '.repeat(mark.length + 1)
      return (
        pad +
        mark +
        ' ' +
        it.text
          .split('\n')
          .map((l, idx) => (idx === 0 ? ink(l, d) : hang + ink(l, d)))
          .join('\n')
      )
    })
    .join('\n')
}

function pipeTable(header: string[], rows: string[][]): string {
  const width = Math.max(header.length, ...rows.map(r => r.length))
  const row = (r: string[]) =>
    '| ' + Array.from({ length: width }, (_, c) => (r[c] ?? '').replace(/\|/g, '\\|')).join(' | ') + ' |'
  return [row(header), '|' + ' --- |'.repeat(width), ...rows.map(row)].join('\n')
}

export function renderText(blocks: Block[], d: Dialect): string {
  const out: string[] = []
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading':
        out.push(d.heading(b.level, ink(b.text, d)))
        break
      case 'para':
        out.push(ink(b.text, d))
        break
      case 'code':
        out.push(d.code(b.lang, b.lines.join('\n')))
        break
      case 'quote':
        out.push(d.quote(ink(b.text, d)))
        break
      case 'rule':
        if (d.rule !== undefined) out.push(d.rule)
        break
      case 'table': {
        if (d.table === 'pipes') out.push(pipeTable(b.header, b.rows))
        else {
          const lines = alignedTable(b.header, b.rows, c => inline(c, plainStyle)).join('\n')
          out.push(d.table === 'code' ? d.code('', lines) : lines)
        }
        break
      }
      case 'list':
        out.push(renderList(b.items, d))
        break
    }
  }
  return out.join('\n\n').trim() + '\n'
}

const fence = (lang: string, body: string) => '```' + lang + '\n' + body + '\n```'
const fenceNoLang = (_lang: string, body: string) => fence('', body)
const quoteLines = (text: string) => text.split('\n').map(l => `> ${l}`).join('\n')
const glyphBullet = (depth: number) => (depth === 0 ? '•' : depth === 1 ? '◦' : '▪')
const number = (n: string) => `${n}.`

export const DIALECTS = {
  slack: {
    style: slackStyle,
    heading: (_l, t) => `*${inline(t, plainStyle)}*`,
    bullet: glyphBullet,
    number,
    indent: d => '    '.repeat(d),
    code: fenceNoLang,
    quote: quoteLines,
    rule: undefined,
    table: 'code',
  },
  whatsapp: {
    style: whatsappStyle,
    heading: (_l, t) => `*${inline(t, plainStyle)}*`,
    bullet: () => '-',
    number,
    indent: d => '  '.repeat(d),
    code: fenceNoLang,
    quote: quoteLines,
    rule: undefined,
    table: 'code',
  },
  telegram: {
    style: telegramStyle,
    heading: (_l, t) => `**${inline(t, plainStyle)}**`,
    bullet: glyphBullet,
    number,
    indent: d => '    '.repeat(d),
    code: fence,
    quote: quoteLines,
    rule: undefined,
    table: 'code',
  },
  // Discord: Markdown with headings to h3, lists, fences with a language, no tables
  discord: {
    style: mdStyle,
    verbatim: true,
    heading: (l, t) => (l <= 3 ? `${'#'.repeat(l)} ${t}` : `**${t}**`),
    bullet: () => '-',
    number,
    indent: d => '  '.repeat(d),
    code: fence,
    quote: quoteLines,
    rule: undefined,
    table: 'code',
  },
  md: {
    style: mdStyle,
    verbatim: true,
    heading: (l, t) => `${'#'.repeat(l)} ${t}`,
    bullet: () => '-',
    number,
    indent: d => '  '.repeat(d),
    code: fence,
    quote: quoteLines,
    rule: '---',
    table: 'pipes',
  },
  plain: {
    style: plainStyle,
    heading: (_l, t) => t,
    bullet: () => '-',
    number,
    indent: d => '  '.repeat(d),
    code: (_lang, body) => body.split('\n').map(l => '    ' + l).join('\n'),
    quote: quoteLines,
    rule: '—',
    table: 'aligned',
  },
} satisfies Record<string, Dialect>

export const toMarkdown = (blocks: Block[]) => renderText(blocks, DIALECTS.md)
export const toSlack = (blocks: Block[]) => renderText(blocks, DIALECTS.slack)
export const toPlain = (blocks: Block[]) => renderText(blocks, DIALECTS.plain)
export const toDiscord = (blocks: Block[]) => renderText(blocks, DIALECTS.discord)
export const toWhatsApp = (blocks: Block[]) => renderText(blocks, DIALECTS.whatsapp)
export const toTelegram = (blocks: Block[]) => renderText(blocks, DIALECTS.telegram)

export function toJira(blocks: Block[]): string {
  const out: string[] = []
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading':
        out.push(`h${Math.min(b.level, 6)}. ${inline(b.text, jiraStyle)}`)
        break
      case 'para':
        out.push(inline(b.text, jiraStyle))
        break
      case 'code':
        out.push((b.lang ? `{code:${b.lang}}` : '{code}') + '\n' + b.lines.join('\n') + '\n{code}')
        break
      case 'quote':
        out.push('{quote}\n' + inline(b.text, jiraStyle) + '\n{quote}')
        break
      case 'rule':
        out.push('----')
        break
      case 'table': {
        const head = '||' + b.header.map(c => inline(c, jiraStyle) || ' ').join('||') + '||'
        const rows = b.rows.map(r => '|' + r.map(c => inline(c, jiraStyle) || ' ').join('|') + '|')
        out.push([head, ...rows].join('\n'))
        break
      }
      case 'list': {
        const markers: string[] = []
        out.push(
          b.items
            .map(it => {
              markers.length = it.depth
              markers.push(it.ordered ? '#' : '*')
              return markers.join('') + ' ' + it.text.split('\n').map(l => inline(l, jiraStyle)).join('\n')
            })
            .join('\n'),
        )
        break
      }
    }
  }
  return out.join('\n\n').trim() + '\n'
}

// ---------------------------------------------------------------- html

export type HtmlOptions = {
  /** Slack has no headings: write them as a bold paragraph. */
  headingsAsBold?: boolean
  /** Slack has no tables: write them as aligned text in a code block. */
  tablesAsPre?: boolean
  /** Slack has no rules: leave them out. */
  noRules?: boolean
  /**
   * Slack's composer flattens nested lists and drops the bullets of a list
   * whose item holds a line break: write such lists as glyph paragraphs.
   */
  simpleLists?: boolean
  /**
   * Slack's composer puts no space between pasted blocks and merges adjacent
   * code blocks: separate blocks with an empty line.
   */
  blankLines?: boolean
}

function htmlList(items: ListItem[]): string {
  let html = ''
  const open: string[] = []
  let depth = -1
  const closeTo = (d: number) => {
    while (depth > d) {
      html += `</li></${open.pop()}>`
      depth--
    }
  }
  for (const it of items) {
    if (it.depth > depth) {
      while (depth < it.depth) {
        const tag = it.ordered ? 'ol' : 'ul'
        html += `<${tag}>`
        open.push(tag)
        depth++
        if (depth < it.depth) html += '<li>'
      }
    } else {
      closeTo(it.depth)
      html += '</li>'
    }
    html += `<li>${inline(it.text, htmlStyle).replace(/\n/g, '<br>')}`
  }
  closeTo(-1)
  return html.replace(/<\/li><\/(ul|ol)>/g, '</li>\n</$1>').replace(/<li>/g, '\n<li>')
}

function glyphList(items: ListItem[]): string {
  const counters: number[] = []
  return items
    .map(it => {
      counters.length = it.depth + 1
      counters[it.depth] = (counters[it.depth] ?? 0) + 1
      const pad = '&nbsp;'.repeat(4 * it.depth)
      const mark = it.ordered ? `${it.number || counters[it.depth]}.` : glyphBullet(it.depth)
      const text = inline(it.text, htmlStyle).replace(/\n/g, `<br>${pad}&nbsp;&nbsp;`)
      return `<p>${pad}${mark} ${text}</p>`
    })
    .join('\n')
}

export function toHtml(blocks: Block[], options: HtmlOptions = {}): string {
  const out: string[] = []
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading':
        out.push(
          options.headingsAsBold
            ? `<p><strong>${inline(b.text, htmlStyle)}</strong></p>`
            : `<h${b.level}>${inline(b.text, htmlStyle)}</h${b.level}>`,
        )
        break
      case 'para':
        out.push(`<p>${inline(b.text, htmlStyle).replace(/\n/g, '<br>')}</p>`)
        break
      case 'code':
        out.push(
          `<pre><code${b.lang ? ` class="language-${escapeHtml(b.lang)}"` : ''}>${escapeHtml(b.lines.join('\n'))}</code></pre>`,
        )
        break
      case 'quote':
        out.push(`<blockquote><p>${inline(b.text, htmlStyle).replace(/\n/g, '<br>')}</p></blockquote>`)
        break
      case 'rule':
        if (!options.noRules) out.push('<hr>')
        break
      case 'table': {
        if (options.tablesAsPre) {
          out.push(`<pre>${escapeHtml(alignedTable(b.header, b.rows, c => inline(c, plainStyle)).join('\n'))}</pre>`)
          break
        }
        const th = b.header.map(c => `<th>${inline(c, htmlStyle)}</th>`).join('')
        const trs = b.rows.map(r => `<tr>${r.map(c => `<td>${inline(c, htmlStyle)}</td>`).join('')}</tr>`).join('\n')
        out.push(`<table>\n<thead><tr>${th}</tr></thead>\n<tbody>\n${trs}\n</tbody>\n</table>`)
        break
      }
      case 'list': {
        const nested = b.items.some(it => it.depth > 0 || it.text.includes('\n'))
        out.push(options.simpleLists && nested ? glyphList(b.items) : htmlList(b.items))
        break
      }
    }
  }
  const sep = options.blankLines ? '\n<p><br></p>\n' : '\n\n'
  return out.join(sep).trim() + '\n'
}

// ---------------------------------------------------------------- destinations

/**
 * What one format puts on the clipboard: `text` always (the plain-text
 * target, and the only one where no rich clipboard is available), `html`
 * where the destination renders pasted rich text.
 */
export type Converted = { text: string; html?: string }

const SLACK_HTML: HtmlOptions = {
  headingsAsBold: true,
  tablesAsPre: true,
  noRules: true,
  simpleLists: true,
  blankLines: true,
}

export function convertAll(markdown: string, format: Format): Converted {
  if (format === 'raw') {
    return { text: markdown.trim().split('\n').map(l => l.replace(/\s+$/, '')).join('\n') + '\n' }
  }
  const blocks = parse(markdown.trim())
  switch (format) {
    case 'slack':
      // the composer renders pasted HTML; pasted mrkdwn stays literal unless
      // "Format messages with markup" is on, so the text target is the fallback
      return { text: toSlack(blocks), html: toHtml(blocks, SLACK_HTML) }
    case 'teams':
      // Teams renders pasted HTML, lists and tables included; Markdown as the text fallback
      return { text: toMarkdown(blocks), html: toHtml(blocks) }
    case 'discord':
      return { text: toDiscord(blocks) }
    case 'whatsapp':
      return { text: toWhatsApp(blocks) }
    case 'telegram':
      return { text: toTelegram(blocks) }
    case 'jira':
      // Jira Cloud's editor takes the HTML; Jira Server / text mode takes the wiki markup
      return { text: toJira(blocks), html: toHtml(blocks) }
    case 'rich':
      return { text: toPlain(blocks), html: toHtml(blocks) }
    case 'md':
      return { text: toMarkdown(blocks) }
    case 'plain':
      return { text: toPlain(blocks) }
    case 'html':
      return { text: toHtml(blocks) }
  }
}

/** The text form alone. */
export function convert(markdown: string, format: Format): string {
  return convertAll(markdown, format).text
}
