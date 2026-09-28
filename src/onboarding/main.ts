import { TAB_STRIP_FLAGS, openFlag } from '../lib/flags';
import { FLAGS_STORAGE_KEY, getFlagState, type FlagState } from '../lib/storage';
import { $, h, listRow, mount, notice } from '../ui/dom';
import { icon } from '../ui/icons';

const root = $('#app');

function flagStatus(state: FlagState) {
  switch (state.status) {
    case 'working':
      return notice('ok', 'Tabbed mode is working: an Appify app opened with a tab strip.');
    case 'not-working':
      return notice(
        'warn',
        'An Appify app last opened without a tab strip.',
        'Check that both required flags are Enabled and that Chrome has been relaunched. If they are, uninstall and reinstall the app so Chrome picks up the tabbed manifest.',
      );
    default:
      return notice('info', 'Not checked yet. Once you install an app with Appify and open it, this page shows whether tabbed mode works.');
  }
}

function section(title: string, ...children: (HTMLElement | false)[]): HTMLElement {
  return h('section', { class: 'stack' }, h('h3', null, title), ...children);
}

function render(state: FlagState): void {
  mount(
    root,
    h(
      'header',
      { class: 'page-header' },
      h('img', { src: chrome.runtime.getURL('icons/icon-128.png'), alt: '', width: 40, height: 40 }),
      h('div', null, h('h1', null, 'Set up tabbed apps'), h('p', { class: 'secondary' }, 'Three steps, about a minute')),
    ),
    h(
      'p',
      null,
      'Chrome only shows a tab strip in app windows when these experimental flags are on. Extensions can’t change flags themselves, so each button opens the flag for you to set to ',
      h('strong', null, 'Enabled'),
      '.',
    ),
    section(
      '1. Turn on the flags',
      h(
        'div',
        { class: 'card' },
        ...TAB_STRIP_FLAGS.map((flag) =>
          listRow(
            [flag.title, flag.required ? '' : h('span', { class: 'chip' }, 'Optional')],
            [flag.why, h('br'), h('code', null, `#${flag.id}`)],
            h('button', { class: flag.required ? 'btn tonal' : 'btn', onclick: () => openFlag(flag.id) }, icon('openInNew', 18), 'Open flag'),
          ),
        ),
      ),
    ),
    section(
      '2. Relaunch Chrome',
      h('div', { class: 'card' }, listRow('Relaunch after changing flags', ['Click ', h('strong', null, 'Relaunch'), ' at the bottom of the flags page.'])),
    ),
    section(
      '3. Appify a site',
      h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'card-body' },
          h(
            'ol',
            { class: 'steps' },
            h('li', null, 'Open the site, click the Appify icon in the toolbar and choose ', h('strong', null, 'Appify this site'), '.'),
            h('li', null, 'Open the Chrome menu ⋮ › Cast, save and share › Install page as app.'),
          ),
        ),
        h('div', { class: 'card-body' }, flagStatus(state)),
      ),
    ),
    h('div', { class: 'page-actions' }, h('button', { class: 'btn action', onclick: () => window.close() }, 'Done')),
  );
}

getFlagState().then(render);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && FLAGS_STORAGE_KEY in changes) getFlagState().then(render);
});
