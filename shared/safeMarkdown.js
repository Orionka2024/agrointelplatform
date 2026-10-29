/**
 * Safe, minimal Markdown → token tree. The output contains ONLY text; no HTML is ever produced or interpreted.
 * The React layer maps tokens to elements (React escapes text), so model output cannot inject markup/script.
 * Supported: paragraphs, "-", "*" and "1." lists, **bold**. Everything else (including <tags>, links, images) stays literal text.
 */
export function parseInline(line) {
  const out = [];
  const re = /\*\*([^*]+?)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push({ t: 'text', v: line.slice(last, m.index) });
    out.push({ t: 'bold', v: m[1] });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ t: 'text', v: line.slice(last) });
  return out;
}

export function parseSafeMarkdown(text) {
  const blocks = [];
  const lines = String(text ?? '').slice(0, 20000).split(/\r?\n/);
  let list = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const li = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      if (!list) { list = { type: 'ul', items: [] }; blocks.push(list); }
      list.items.push(parseInline(li[1]));
      continue;
    }
    list = null;
    if (line.trim() === '') continue;
    blocks.push({ type: 'p', children: parseInline(line) });
  }
  return blocks;
}
