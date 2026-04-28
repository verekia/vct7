import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { serializeProject } from '../lib/svg-io';

export function CodeButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} title="View SVG code">
        Code
      </button>
      {open && <CodeDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function CodeDialog({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const shapes = useStore((s) => s.shapes);
  const code = useMemo(() => serializeProject(settings, shapes), [settings, shapes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="panel-surface border border-line w-[960px] max-w-[92vw] max-h-[88vh] flex flex-col shadow-2xl">
        <header className="flex items-center justify-between px-4 py-2.5 border-b border-line">
          <h2 className="tracking-[2px] uppercase text-xs font-semibold text-text">SVG code</h2>
          <div className="flex gap-1.5">
            <CopyButton code={code} />
            <button type="button" className="text-[11px] px-2 py-[2px]" onClick={onClose}>
              Close
            </button>
          </div>
        </header>
        <div className="flex-1 min-h-0 overflow-auto p-3 bg-bg-0">
          <pre
            className="text-[14px] leading-[1.6] whitespace-pre-wrap font-mono select-text"
            style={{ width: '120ch', maxWidth: '100%', overflowWrap: 'anywhere' }}
          >
            {highlightXml(code)}
          </pre>
        </div>
      </div>
    </div>
  );
}

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard API rejection (e.g. denied permissions) is harmless here —
      // leave the button in its idle state so the user can retry.
    }
  };
  return (
    <button type="button" className="text-[11px] px-2 py-[2px]" onClick={onCopy}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

const CLS = {
  punct: 'text-muted-2',
  prolog: 'text-muted',
  tag: 'text-accent-2',
  attr: 'text-signal',
  attrVh: 'text-[#7ee787]',
  value: 'text-text',
  cssSelector: 'text-accent-2',
  cssAtRule: 'text-[#c792ea]',
  cssProp: 'text-signal',
  cssValue: 'text-text',
  cssPunct: 'text-muted-2',
};

const NAME_RE = /^[\w:.-]+/;
const WS_RE = /^\s+/;
const CSS_TOKEN_RE =
  /(@[\w-]+)|(\.[\w-]+|#[\w-]+)|([\w-]+)(\s*:)|([{};:,])|("[^"]*"|'[^']*')|(\s+)|([^\s{};:,]+)/g;

function highlightXml(code: string): ReactNode {
  const parts: ReactNode[] = [];
  let key = 0;
  const push = (cls: string, text: string) => {
    if (!text) return;
    parts.push(
      cls ? (
        <span key={key++} className={cls}>
          {text}
        </span>
      ) : (
        <Fragment key={key++}>{text}</Fragment>
      ),
    );
  };

  let i = 0;
  while (i < code.length) {
    if (code.startsWith('<?', i)) {
      const end = code.indexOf('?>', i);
      const stop = end === -1 ? code.length : end + 2;
      push(CLS.prolog, code.slice(i, stop));
      i = stop;
      continue;
    }
    if (code.startsWith('</', i)) {
      const end = code.indexOf('>', i);
      const stop = end === -1 ? code.length : end;
      push(CLS.punct, '</');
      push(CLS.tag, code.slice(i + 2, stop));
      push(CLS.punct, '>');
      i = stop + 1;
      continue;
    }
    if (code[i] === '<') {
      push(CLS.punct, '<');
      i++;
      const nameMatch = NAME_RE.exec(code.slice(i));
      const tagName = nameMatch ? nameMatch[0] : '';
      if (nameMatch) {
        push(CLS.tag, nameMatch[0]);
        i += nameMatch[0].length;
      }
      while (i < code.length) {
        const ch = code[i];
        if (ch === '>') {
          push(CLS.punct, '>');
          i++;
          break;
        }
        if (ch === '/' && code[i + 1] === '>') {
          push(CLS.punct, '/>');
          i += 2;
          break;
        }
        const wsMatch = WS_RE.exec(code.slice(i));
        if (wsMatch) {
          push('', wsMatch[0]);
          i += wsMatch[0].length;
          continue;
        }
        const attrMatch = NAME_RE.exec(code.slice(i));
        if (attrMatch) {
          push(attrMatch[0].startsWith('data-vh-') ? CLS.attrVh : CLS.attr, attrMatch[0]);
          i += attrMatch[0].length;
          if (code[i] === '=') {
            push(CLS.punct, '=');
            i++;
            const quote = code[i];
            if (quote === '"' || quote === "'") {
              const end = code.indexOf(quote, i + 1);
              const stop = end === -1 ? code.length : end + 1;
              push(CLS.value, code.slice(i, stop));
              i = stop;
            }
          }
          continue;
        }
        // Unrecognized character inside a tag — emit raw and advance so we
        // never loop forever on malformed input.
        push('', ch);
        i++;
      }
      // After the opening <style>, slurp the CSS body so it can be
      // highlighted with CSS-aware rules instead of being a plain text run.
      if (tagName === 'style') {
        const closeIdx = code.indexOf('</style>', i);
        const bodyEnd = closeIdx === -1 ? code.length : closeIdx;
        if (bodyEnd > i) {
          highlightCss(code.slice(i, bodyEnd), push);
          i = bodyEnd;
        }
      }
      continue;
    }
    const next = code.indexOf('<', i);
    const stop = next === -1 ? code.length : next;
    push('', code.slice(i, stop));
    i = stop;
  }
  return parts;
}

function highlightCss(css: string, push: (cls: string, text: string) => void): void {
  CSS_TOKEN_RE.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = CSS_TOKEN_RE.exec(css)) !== null) {
    if (m.index > last) push('', css.slice(last, m.index));
    const [whole, atRule, selector, propName, propColon, punct, str, ws, ident] = m;
    if (atRule) push(CLS.cssAtRule, atRule);
    else if (selector) push(CLS.cssSelector, selector);
    else if (propName) {
      push(CLS.cssProp, propName);
      push(CLS.cssPunct, propColon);
    } else if (punct) push(CLS.cssPunct, punct);
    else if (str) push(CLS.cssValue, str);
    else if (ws) push('', ws);
    else if (ident) push(CLS.cssValue, ident);
    else push('', whole);
    last = m.index + whole.length;
  }
  if (last < css.length) push('', css.slice(last));
}
