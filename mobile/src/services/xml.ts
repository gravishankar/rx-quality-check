/**
 * Minimal, strict XML reader for SPL documents (no dependency). Supports elements, attributes,
 * self-closing tags, text, comments, CDATA, processing instructions and a DOCTYPE without an
 * internal subset; decodes the five predefined entities and numeric character references.
 * Malformed input (mismatched or unclosed tags, unterminated constructs) throws XmlError, which the
 * caller turns into "source product not established" — never into a guess.
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
}

export class XmlError extends Error {
  constructor(message: string, readonly offset: number) {
    super(`${message} at offset ${offset}`);
    this.name = 'XmlError';
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string, at: number): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (_m, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    const v = ENTITIES[e];
    if (v === undefined) throw new XmlError(`unknown entity &${e};`, at);
    return v;
  });
}

const NAME = /^[A-Za-z_][\w.:-]*/;
const ATTR = /\s*([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/y;

export function parseXml(xml: string): XmlElement {
  let i = 0;
  const root: XmlElement = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlElement[] = [root];
  const top = () => stack[stack.length - 1] as XmlElement;
  const skipTo = (end: string, what: string) => {
    const j = xml.indexOf(end, i);
    if (j < 0) throw new XmlError(`unterminated ${what}`, i);
    const content = xml.slice(i, j);
    i = j + end.length;
    return content;
  };
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      top().text += decode(xml.slice(i), i);
      break;
    }
    if (lt > i) top().text += decode(xml.slice(i, lt), i);
    i = lt;
    if (xml.startsWith('<!--', i)) {
      i += 4;
      skipTo('-->', 'comment');
    } else if (xml.startsWith('<![CDATA[', i)) {
      i += 9;
      top().text += skipTo(']]>', 'CDATA');
    } else if (xml.startsWith('<?', i)) {
      i += 2;
      skipTo('?>', 'processing instruction');
    } else if (xml.startsWith('<!DOCTYPE', i)) {
      const j = xml.indexOf('>', i);
      if (j < 0) throw new XmlError('unterminated DOCTYPE', i);
      if (xml.slice(i, j).includes('[')) throw new XmlError('DOCTYPE internal subsets are not supported', i);
      i = j + 1;
    } else if (xml.startsWith('</', i)) {
      i += 2;
      const m = NAME.exec(xml.slice(i));
      if (!m) throw new XmlError('bad closing tag', i);
      const name = m[0];
      i += name.length;
      const gt = xml.indexOf('>', i);
      if (gt < 0 || xml.slice(i, gt).trim() !== '') throw new XmlError('bad closing tag', i);
      i = gt + 1;
      const open = stack.pop();
      if (!open || open === root || open.name !== name) throw new XmlError(`mismatched </${name}>`, i);
    } else {
      i += 1;
      const m = NAME.exec(xml.slice(i));
      if (!m) throw new XmlError('bad tag', i);
      const el: XmlElement = { name: m[0], attrs: {}, children: [], text: '' };
      i += m[0].length;
      for (;;) {
        ATTR.lastIndex = i;
        const a = ATTR.exec(xml);
        if (!a) break;
        el.attrs[a[1] as string] = decode(a[3] ?? a[4] ?? '', i);
        i = ATTR.lastIndex;
      }
      while (/\s/.test(xml[i] ?? '')) i++;
      top().children.push(el);
      if (xml.startsWith('/>', i)) {
        i += 2;
      } else if (xml[i] === '>') {
        i += 1;
        stack.push(el);
      } else {
        throw new XmlError(`malformed tag <${el.name}>`, i);
      }
    }
  }
  if (stack.length !== 1) throw new XmlError(`unclosed <${top().name}>`, xml.length);
  return root;
}

/** Depth-first search for elements with a (local) name. */
export function findAll(el: XmlElement, name: string, out: XmlElement[] = []): XmlElement[] {
  for (const c of el.children) {
    if (c.name === name || c.name.endsWith(`:${name}`)) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

export function child(el: XmlElement, name: string): XmlElement | undefined {
  return el.children.find((c) => c.name === name || c.name.endsWith(`:${name}`));
}
