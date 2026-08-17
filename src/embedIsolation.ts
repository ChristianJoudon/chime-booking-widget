import widgetStyles from '@/index.css?inline';

/**
 * Renders the widget inside a shadow root, so host-page CSS cannot reach it.
 *
 * The widget is dropped onto sites nobody here controls. Defending against
 * their stylesheets in the cascade works — `!important` on the widget's own
 * declarations, inherit floors on descendants — but it is a standing agreement
 * that every future edit has to keep. One more `!important` in the wrong place
 * quietly undoes it, and nothing fails loudly.
 *
 * A shadow boundary makes it structural instead. Selectors in the host document
 * do not match anything inside, whatever their specificity and whatever they
 * mark important.
 *
 * Inherited properties are the exception: font-family, font-size, line-height,
 * colour and direction still cross. The widget already resets those on
 * `.chime-widget`, which sits inside the shadow, so they are answered where the
 * widget's own styling begins.
 */

/** Marks the stylesheet this module injects, so it is only added once. */
const STYLE_MARKER = 'data-chime-styles';

/**
 * Attaches a shadow root to `host`, or to a plain `<div>` inside it when the
 * element itself cannot have one.
 *
 * Only a fixed list of elements may host a shadow root — `<dialog>` and
 * `<button>` may not, and a host page's mount point could be anything. Feature
 * detection is a try/catch rather than an allowlist because the list is the
 * browser's, not ours, and a copy of it here would drift.
 *
 * Safe to call twice on the same host: the shadow root and its stylesheet are
 * reused, which matters because `autoMount` can run more than once.
 */
function attach(host: HTMLElement): ShadowRoot | null {
  if (host.shadowRoot) return host.shadowRoot;
  try {
    return host.attachShadow({ mode: 'open' });
  } catch {
    return null;
  }
}

export function isolate(host: HTMLElement): HTMLElement {
  let shadow = attach(host);

  if (!shadow) {
    const existing = host.querySelector<HTMLElement>(':scope > [data-chime-shell]');
    const shell = existing ?? document.createElement('div');
    if (!existing) {
      shell.setAttribute('data-chime-shell', '');
      host.append(shell);
    }
    shadow = attach(shell);
  }

  if (!shadow) {
    // A <div> always accepts one, so reaching here means something is very
    // wrong with the document. Saying so beats rendering nowhere in silence.
    throw new Error('ChimeWidget: could not create a shadow root to render into.');
  }

  if (!shadow.querySelector(`style[${STYLE_MARKER}]`)) {
    const style = document.createElement('style');
    style.setAttribute(STYLE_MARKER, '');
    style.textContent = widgetStyles;
    shadow.append(style);
  }

  const container = document.createElement('div');
  container.setAttribute('data-chime-container', '');
  shadow.append(container);
  return container;
}

/**
 * Styles the dialog element and its backdrop from the host document.
 *
 * Everything else is inside a shadow root, but the `<dialog>` itself has to sit
 * in the host document to reach the top layer, and `::backdrop` belongs to it
 * rather than to anything inside. These two rules are the entire light-DOM
 * surface the widget keeps, and both degrade gracefully: a host that overrode
 * them would make the overlay plainer, not break the booking flow.
 */
export function ensureDialogStyles(): void {
  const marker = `${STYLE_MARKER}-dialog`;
  if (document.querySelector(`style[${marker}]`)) return;
  const style = document.createElement('style');
  style.setAttribute(marker, '');
  // Copied from the .chime-embed-dialog rules in index.css rather than
  // approximated. If those change, this has to change with them.
  style.textContent = [
    '.chime-embed-dialog{background:transparent;border:0;overflow:visible;',
    'padding:0 !important;height:min(880px,calc(100dvh - 32px));',
    'max-height:none;max-width:none;width:min(720px,calc(100vw - 32px))}',
    '.chime-embed-dialog::backdrop{background:rgba(15,42,34,.52);backdrop-filter:blur(4px)}',
    '@media (max-width:620px){.chime-embed-dialog{height:100dvh;width:100vw}}',
  ].join('');
  document.head.append(style);
}
