import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { convert, convertAll, parse, resolveFormat } from './format'
import { pickText } from './register'

const SAMPLE = `## Summary

Here is **bold**, *italic*, \`code\` and a [link](https://example.com).

- First item
- Second item
  - Nested item
- Third with \`inline\`

1. Step one
2. Step two

\`\`\`bash
npm install
npm test
\`\`\`

| Col A | Col B |
|-------|-------|
| 1     | two   |

> A quote`

describe('parse', () => {
  test('splits the sample into blocks', () => {
    const kinds = parse(SAMPLE).map(b => b.kind)
    expect(kinds).toEqual(['heading', 'para', 'list', 'list', 'code', 'table', 'quote'])
  })

  test('joins soft-wrapped paragraph lines and keeps nested list depth', () => {
    const blocks = parse('one\ntwo\n\n- a\n  - b\n    - c')
    expect(blocks[0]).toEqual({ kind: 'para', text: 'one two' })
    const list = blocks[1]
    if (list?.kind !== 'list') throw new Error('expected list')
    expect(list.items.map(item => item.depth)).toEqual([0, 1, 2])
  })

  test('a year followed by a dot does not start a list', () => {
    expect(parse('Shipped in\n2024. Then more.').map(b => b.kind)).toEqual(['para'])
  })
})

describe('slack', () => {
  const out = convert(SAMPLE, 'slack')
  test('uses mrkdwn emphasis and bold headings', () => {
    expect(out).toContain('*Summary*')
    expect(out).toContain('*bold*, _italic_, `code` and a link (https://example.com)')
  })
  test('uses bullet glyphs with nesting and keeps numbering', () => {
    expect(out).toContain('• First item\n• Second item\n    ◦ Nested item\n• Third with `inline`')
    expect(out).toContain('1. Step one\n2. Step two')
  })
  test('drops the code fence language and puts tables in a code block', () => {
    expect(out).toContain('```\nnpm install\nnpm test\n```')
    expect(out).toContain('```\nCol A | Col B')
  })
  test('has no line starting with stray whitespace outside nested lists', () => {
    const bad = out.split('\n').filter(l => /^\s+/.test(l) && !/^\s+◦/.test(l))
    expect(bad).toEqual([])
  })
})

describe('jira', () => {
  const out = convert(SAMPLE, 'jira')
  test('renders headings, emphasis, links and code', () => {
    expect(out).toContain('h2. Summary')
    expect(out).toContain('*bold*, _italic_, {{code}} and a [link|https://example.com]')
    expect(out).toContain('{code:bash}\nnpm install\nnpm test\n{code}')
  })
  test('renders lists with marker chains and tables with || headers', () => {
    expect(out).toContain('* First item\n* Second item\n** Nested item')
    expect(out).toContain('# Step one\n# Step two')
    expect(out).toContain('||Col A||Col B||\n|1|two|')
    expect(out).toContain('{quote}\nA quote\n{quote}')
  })
})

describe('md', () => {
  test('normalises bullets and keeps inline markdown intact', () => {
    const out = convert('* a\n* b\n\n**x** and `y`', 'md')
    expect(out).toBe('- a\n- b\n\n**x** and `y`\n')
  })
})

describe('plain', () => {
  test('strips all markup', () => {
    const out = convert(SAMPLE, 'plain')
    expect(out).toContain('Summary\n\nHere is bold, italic, code and a link (https://example.com).')
    expect(out).toContain('- First item\n- Second item\n  - Nested item')
    expect(out).not.toContain('**')
    expect(out).not.toContain('```')
  })
})

describe('html', () => {
  test('nests lists and escapes code', () => {
    const out = convert('- a\n  - b\n- c\n\n`<x>`', 'html')
    expect(out).toContain('<ul>\n<li>a<ul>\n<li>b</li>\n</ul></li>\n<li>c</li>\n</ul>')
    expect(out).toContain('<p><code>&lt;x&gt;</code></p>')
  })
})

describe('inline nesting', () => {
  test('keeps a code span inside bold', () => {
    expect(convert('**Add `--debug`** if needed', 'slack')).toBe('*Add `--debug`* if needed\n')
    expect(convert('**Add `--debug`** if needed', 'jira')).toBe('*Add {{--debug}}* if needed\n')
    expect(convert('**Add `--debug`** if needed', 'plain')).toBe('Add --debug if needed\n')
  })
  test('leaves an unmatched backtick run literal and still closes later spans', () => {
    expect(convert('Pasting `*bold*` or a ``` fence keeps it, the `text/html` target.', 'plain')).toBe(
      'Pasting *bold* or a ``` fence keeps it, the text/html target.\n',
    )
    expect(convert('a ``x`y`` b', 'slack')).toBe('a `x`y` b\n')
  })
  test('keeps a link inside bold and emphasis inside a link', () => {
    expect(convert('**see [docs](https://x.y)**', 'slack')).toBe('*see docs (https://x.y)*\n')
    expect(convert('[*docs*](https://x.y)', 'html')).toBe('<p><a href="https://x.y"><em>docs</em></a></p>\n')
  })
})

describe('rich forms', () => {
  test('slack carries Slack-flavoured html beside mrkdwn text', () => {
    const out = convertAll('## Title\n\n- **a**\n\n| h |\n|---|\n| 1 |\n\n---', 'slack')
    expect(out.text).toContain('*Title*')
    expect(out.html).toContain('<p><strong>Title</strong></p>')
    expect(out.html).toContain('<li><strong>a</strong></li>')
    expect(out.html).toContain('<pre>h\n-\n1</pre>')
    expect(out.html).not.toContain('<hr>')
  })
  test('jira carries standard html beside wiki markup; md and plain carry text only', () => {
    expect(convertAll('## T', 'jira')).toEqual({ text: 'h2. T\n', html: '<h2>T</h2>\n' })
    expect(convertAll('## T', 'rich')).toEqual({ text: 'T\n', html: '<h2>T</h2>\n' })
    expect(convertAll('## T', 'md')).toEqual({ text: '## T\n' })
    expect(convertAll('## T', 'plain')).toEqual({ text: 'T\n' })
  })
})

describe('escapes', () => {
  test('an escaped backtick is a literal backtick, not a code span', () => {
    expect(convert('a literal \\`backtick\\` here', 'plain')).toBe('a literal `backtick` here\n')
    expect(convert('a literal \\`backtick\\` here', 'html')).toBe('<p>a literal `backtick` here</p>\n')
    expect(convert('a literal \\`backtick\\` and `code`', 'slack')).toBe('a literal `backtick` and `code`\n')
  })
})

describe('slack html', () => {
  test('separates blocks with empty lines so adjacent code blocks do not merge', () => {
    const { html } = convertAll('```a\nx\n```\n\n```b\ny\n```', 'slack')
    expect(html).toContain('</code></pre>\n<p><br></p>\n<pre>')
  })
  test('writes nested lists and lists with line breaks as glyph paragraphs', () => {
    const { html } = convertAll('1. one\n   - sub\n\nthen\n\n- flat\n- list', 'slack')
    expect(html).toContain('<p>1. one</p>\n<p>&nbsp;&nbsp;&nbsp;&nbsp;◦ sub</p>')
    expect(html).toContain('<ul>\n<li>flat</li>\n<li>list</li>\n</ul>')
  })
})

describe('chat dialects', () => {
  const SRC = '## Title\n\n**b** *i* ~~s~~ `c` [d](https://x.y)\n\n- a\n  - b\n\n```ts\ncode\n```'
  test('discord keeps Markdown, caps headings at h3, keeps fence languages', () => {
    expect(convert(SRC, 'discord')).toBe('## Title\n\n**b** *i* ~~s~~ `c` [d](https://x.y)\n\n- a\n  - b\n\n```ts\ncode\n```\n')
    expect(convert('#### deep', 'discord')).toBe('**deep**\n')
  })
  test('whatsapp uses single marks, dash bullets and fences without a language', () => {
    expect(convert(SRC, 'whatsapp')).toBe('*Title*\n\n*b* _i_ ~s~ `c` d (https://x.y)\n\n- a\n  - b\n\n```\ncode\n```\n')
  })
  test('telegram uses double marks and glyph bullets', () => {
    expect(convert(SRC, 'telegram')).toBe('**Title**\n\n**b** __i__ ~~s~~ `c` d (https://x.y)\n\n• a\n    ◦ b\n\n```ts\ncode\n```\n')
  })
  test('teams carries standard html beside Markdown', () => {
    const out = convertAll('## T\n\n- a', 'teams')
    expect(out).toEqual({ text: '## T\n\n- a\n', html: '<h2>T</h2>\n\n<ul>\n<li>a</li>\n</ul>\n' })
  })
  test('raw returns the reply as written, trailing spaces stripped', () => {
    expect(convert('## T  \n\n*  weird   \n', 'raw')).toBe('## T\n\n*  weird\n')
  })
  test('aliases map common tools to their destination', () => {
    expect(['email', 'gmail', 'outlook', 'docs', 'word', 'notion'].map(resolveFormat)).toEqual(Array(6).fill('rich'))
    expect(['github', 'gitlab', 'linear', 'obsidian'].map(resolveFormat)).toEqual(Array(4).fill('md'))
    expect(['gchat', 'confluence', 'signal', 'tg', 'msteams'].map(resolveFormat)).toEqual(['slack', 'jira', 'whatsapp', 'telegram', 'teams'])
  })
})

describe('pickText', () => {
  const messages = [
    { role: 'user' as const, text: 'do it' },
    { role: 'assistant' as const, text: 'Working on it.' },
    { role: 'user' as const, text: '', toolResults: [{}] },
    { role: 'assistant' as const, text: 'Done: **ok**' },
  ]
  test('takes the final reply by default', () => {
    expect(pickText(messages, false)).toEqual({ text: 'Done: **ok**', count: 1 })
  })
  test('takes every reply of the last turn with "turn"', () => {
    expect(pickText(messages, true)).toEqual({ text: 'Working on it.\n\nDone: **ok**', count: 2 })
  })
  test('N reaches an earlier reply, and turn widens to that turn', () => {
    const longer = [
      ...messages,
      { role: 'user' as const, text: 'and now?' },
      { role: 'assistant' as const, text: 'Later reply' },
    ]
    expect(pickText(longer, false, 2)).toEqual({ text: 'Done: **ok**', count: 1 })
    expect(pickText(longer, true, 2)).toEqual({ text: 'Working on it.\n\nDone: **ok**', count: 2 })
    expect(pickText(longer, false, 4)).toBeUndefined()
  })
  test('answers undefined with no reply', () => {
    expect(pickText([{ role: 'user', text: 'hi' }], false)).toBeUndefined()
  })
})

const run = ($: Engine, args: string) =>
  $.command.run({ command: 'copyas', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

describe('/copyas command', () => {
  const session = [
    { role: 'user' as const, text: 'summarise', toolUses: [] },
    { role: 'assistant' as const, text: '## Done\n\n- **one**\n- two', toolUses: [] },
  ]
  const noTools = (on: On) =>
    on('process.run', () => ({
      value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }))
  const wire = (on: On, copies: string[], messages: typeof session) => {
    noTools(on)
    on('session.messages', () => ({ value: messages }))
    on('env.get', () => ({ value: undefined }))
    on('ui.copy', ($, e) => {
      copies.push(e.text)
      return { value: { isCopied: true as const } }
    })
    on('ui.toast', () => ({ value: undefined }))
  }

  test('copies the last reply converted to the asked format', async ($, on) => {
    const copies: string[] = []
    wire(on, copies, session)
    const ran = await run($, 'slack')
    expect(ran.text).toContain('Copied last reply as Slack mrkdwn text')
    expect(ran.text).toContain('Rich paste unavailable')
    expect(copies).toEqual(['*Done*\n\n• *one*\n• two\n'])
  })

  test('falls back to the configured default format', { options: { default_format: 'jira' } }, async ($, on) => {
    const copies: string[] = []
    wire(on, copies, session)
    await run($, '')
    expect(copies).toEqual(['h2. Done\n\n* *one*\n* two\n'])
  })

  test('reports nothing to copy, shows usage, rejects unknown words', async ($, on) => {
    const copies: string[] = []
    wire(on, copies, [])
    const empty = await run($, 'slack')
    expect(empty.text).toContain('Nothing to copy')
    expect(copies).toEqual([])
    const help = await run($, 'help')
    expect(help.text).toContain('Usage: /copyas')
    const bad = await run($, 'foo')
    expect(bad.text).toContain('Unknown option "foo"')
  })

  test('"text" skips the rich clipboard without a probe', async ($, on) => {
    const copies: string[] = []
    on('session.messages', () => ({ value: session }))
    on('env.get', () => ({ value: undefined }))
    on('ui.copy', ($, e) => {
      copies.push(e.text)
      return { value: { isCopied: true as const } }
    })
    on('ui.toast', () => ({ value: undefined }))
    const ran = await run($, 'slack text')
    expect(ran.text).toBe('Copied last reply as Slack mrkdwn text (5 lines).')
    expect(copies).toEqual(['*Done*\n\n• *one*\n• two\n'])
  })

  test('says where the text was saved when the clipboard is unavailable', async ($, on) => {
    noTools(on)
    on('session.messages', () => ({ value: session }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', () => ({ value: undefined }))
    on('ui.copy', () => ({ value: { isCopied: false as const, reason: 'no-clipboard' as const } }))
    const ran = await run($, 'plain')
    expect(ran.text).toContain('Could not copy')
    expect(ran.text).toContain('/home/me/.claude/copyas/last.txt')
  })
})
