import { ensureDialogStyles } from './embedIsolation';

type DisplayMode = 'inline' | 'modal' | 'floating_button';

interface MountHandle {
  unmount: () => void;
}

/**
 * `mount` genuinely cannot take any `Element`: it renders HTML into a shadow
 * root, and only HTML elements can host one. This type used to say `Element`,
 * which was a promise the implementation could not keep and the reason
 * `typecheck:widget` failed.
 */
type MountWidget = (target: string | HTMLElement) => MountHandle;

/** Attaches a shadow root to an element and returns a container inside it. */
type Isolate = (host: HTMLElement) => HTMLElement;

function displayMode(element: HTMLElement): DisplayMode {
  const value = element.dataset.chimeDisplay;
  return value === 'modal' || value === 'floating_button' ? value : 'inline';
}

function closeDialog(dialog: HTMLDialogElement) {
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}

export function mountConfiguredElement(
  element: Element,
  mount: MountWidget,
  isolate: Isolate,
): MountHandle | null {
  // An SVG or MathML node can match the mount selector, and cannot carry the
  // widget — it has no dataset to read a display mode from, and cannot host a
  // shadow root. Declining is better than mounting into something that cannot
  // work. This signature has always allowed null; nothing reached it before.
  if (!(element instanceof HTMLElement)) return null;

  if (displayMode(element) === 'inline') return mount(element);

  const mode = displayMode(element);
  const label = element.dataset.chimeButtonLabel?.trim() || 'Book an appointment';
  element.dataset.chimeMounted = 'true';

  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = `chime-embed-launcher chime-embed-launcher--${mode}`;
  launcher.setAttribute('aria-haspopup', 'dialog');
  launcher.textContent = label;

  const dialog = document.createElement('dialog');
  dialog.className = 'chime-embed-dialog';
  dialog.setAttribute('aria-label', `${label} booking window`);

  // Appended into the dialog's shadow root below rather than to the dialog
  // directly.
  const surface = document.createElement('div');
  surface.className = 'chime-embed-dialog__surface';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'chime-embed-dialog__close';
  closeButton.setAttribute('aria-label', 'Close booking window');
  closeButton.textContent = '×';
  const widgetTarget = document.createElement('div');
  widgetTarget.className = 'chime-embed-dialog__widget';
  surface.append(closeButton, widgetTarget);

  let handle: MountHandle | null = null;
  const open = () => {
    if (!handle) handle = mount(widgetTarget);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  };

  launcher.addEventListener('click', open);
  closeButton.addEventListener('click', () => closeDialog(dialog));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog(dialog);
  });
  // The launcher and the dialog surface are the widget's chrome, not the host's,
  // so each gets its own shadow root. Without this they stay in the host
  // document and a rule like `button { width: 100% !important }` reshapes them
  // even though the widget itself is isolated.
  element.replaceChildren();
  const launcherShell = isolate(element);
  launcherShell.append(launcher);

  document.body.append(dialog);
  ensureDialogStyles();
  isolate(dialog).append(surface);

  return {
    unmount() {
      launcher.removeEventListener('click', open);
      handle?.unmount();
      dialog.remove();
      // replaceChildren() clears the light DOM, which no longer holds the
      // launcher — it lives in the shadow root. A shadow root cannot be
      // detached once attached, so the container inside it is what goes.
      launcherShell.remove();
      element.replaceChildren();
      delete element.dataset.chimeMounted;
    },
  };
}
