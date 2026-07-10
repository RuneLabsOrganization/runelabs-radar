/**
 * Minimal, safe markdown renderer for daily briefs.
 *
 * All input HTML is escaped first — there is NO raw-HTML passthrough.
 * Supported syntax: #/##/### headings, **bold**, *italic*, `inline code`,
 * "- " lists, [text](http(s) links → target="_blank"), paragraphs.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Links / bold / italic over an already-escaped, code-free segment. */
function formatText(escaped: string): string {
  let out = escaped;

  // Links — http(s) only, so javascript:/data: URLs never become anchors.
  out = out.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );

  // Bold before italic so ** pairs are not consumed as two * pairs.
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  return out;
}

/**
 * Inline formatting over already-escaped text. Code spans are split out first
 * so their contents skip link/bold/italic handling — no placeholders needed.
 */
function renderInline(escaped: string): string {
  const parts = escaped.split(/(`[^`\n]+`)/);
  return parts
    .map((part) => {
      if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
        return `<code>${part.slice(1, -1)}</code>`;
      }
      return formatText(part);
    })
    .join('');
}

export function renderMarkdown(md: string): string {
  const lines = escapeHtml(md).split(/\r?\n/);
  const html: string[] = [];
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${renderInline(para.join(' '))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      html.push(`<ul>${list.map((li) => `<li>${renderInline(li)}</li>`).join('')}</ul>`);
      list = [];
    }
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      flushPara();
      flushList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(t);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }
    if (t.startsWith('- ')) {
      flushPara();
      list.push(t.slice(2));
      continue;
    }
    flushList();
    para.push(t);
  }
  flushPara();
  flushList();
  return html.join('\n');
}
