// A small element builder so the pages can stay framework-free. Strings are
// always inserted as text, never HTML, since titles and names come from sites.

import { icon } from './icons';

export type Child = Node | string | number | false | null | undefined;
type Props = Record<string, unknown> & {
  class?: string;
  style?: string;
  dataset?: Record<string, string>;
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'style') el.setAttribute('style', String(value));
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key in el) {
      // DOM properties (value, checked, href…) rather than attributes.
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === false || child === null || child === undefined) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export function mount(root: HTMLElement, ...children: (Child | Child[])[]): void {
  root.replaceChildren(
    ...children
      .flat()
      .filter((c) => c !== false && c !== null && c !== undefined)
      .map((c) => (c instanceof Node ? c : String(c))),
  );
}

export function $(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Missing ${selector}`);
  return el;
}

const NOTICE_ICONS = { info: 'info', warn: 'warning', error: 'error', ok: 'checkCircle' } as const;

/** A tonal message box with a leading icon. `tone` picks the colour. */
export function notice(tone: 'info' | 'warn' | 'error' | 'ok', ...children: (Child | Child[])[]): HTMLDivElement {
  return h(
    'div',
    { class: `notice notice-${tone}`, role: tone === 'error' ? 'alert' : 'status' },
    icon(NOTICE_ICONS[tone]),
    h('div', { class: 'notice-body' }, ...children),
  );
}

/** Chrome-style on/off switch. */
export function toggle(checked: boolean, onchange: (checked: boolean) => void, label?: string): HTMLInputElement {
  return h('input', {
    type: 'checkbox',
    class: 'toggle',
    role: 'switch',
    checked,
    'aria-label': label,
    onchange: (e: Event) => onchange((e.target as HTMLInputElement).checked),
  });
}

/** A settings list row: title and optional secondary text, with a control on the right. */
export function listRow(title: Child | Child[], secondary?: Child | Child[], control?: Child | Child[]): HTMLDivElement {
  return h(
    'div',
    { class: 'list-row' },
    h('div', { class: 'list-row-text' }, h('div', { class: 'list-row-title' }, title), secondary && h('div', { class: 'secondary' }, secondary)),
    control,
  );
}

/** A list row that is a label for its switch, so the whole row toggles it. */
export function toggleRow(title: string, secondary: string, checked: boolean, onchange: (checked: boolean) => void): HTMLLabelElement {
  return h(
    'label',
    { class: 'list-row clickable' },
    h('div', { class: 'list-row-text' }, h('div', { class: 'list-row-title' }, title), h('div', { class: 'secondary' }, secondary)),
    toggle(checked, onchange),
  );
}
