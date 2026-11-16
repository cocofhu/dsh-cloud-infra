import * as React from 'react'

/** Inline: **bold**, *italic*, `code`, [text](https://…). Everything else stays text. */
function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*([^*]+)\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const key = `${keyBase}-${i++}`
    if (m[2] !== undefined) out.push(<strong key={key}>{m[2]}</strong>)
    else if (m[4] !== undefined) out.push(<code key={key} className="ci-code">{m[4]}</code>)
    else if (m[6] !== undefined) out.push(<a key={key} href={m[7]} target="_blank" rel="noreferrer noopener">{m[6]}</a>)
    else if (m[9] !== undefined) out.push(<em key={key}>{m[9]}</em>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = []
  const lines = String(text ?? '').split(/\r?\n/)
  let i = 0
  let k = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) { i++; continue }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      const Tag = `h${Math.min(4, heading[1]!.length + 1)}` as 'h2'
      blocks.push(<Tag key={k++}>{inline(heading[2]!, `h${k}`)}</Tag>)
      i++
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*]|\d+\.)\s+/, ''))
      const List = ordered ? 'ol' : 'ul'
      blocks.push(<List key={k++}>{items.map((it, j) => <li key={j}>{inline(it, `l${k}-${j}`)}</li>)}</List>)
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4})\s|^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) para.push(lines[i++]!)
    blocks.push(<p key={k++}>{inline(para.join(' '), `p${k}`)}</p>)
  }
  return <div className="ci-md">{blocks}</div>
}
