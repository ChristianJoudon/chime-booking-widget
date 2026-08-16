type DisplayMode = 'inline' | 'modal' | 'floating_button';

interface MountHandle {
  unmount: () => void;
}

type MountWidget = (target: string | Element) => MountHandle;

function displayMode(element: HTMLElement): DisplayMode {
  const value = element.dataset.chimeDisplay;
  return value === 'modal' || value === 'floating_button' ? value : 'inline';
}

function closeDialog(dialog: HTMLDialogElement) {
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}

export function mountConfiguredElement(element: Element, mount: MountWidget): MountHandle | null {
  if (!(element instanceof HTMLElement) || displayMode(element) === 'inline') {
    return mount(element);
  }

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
  dialog.append(surface);

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
  element.replaceChildren(launcher);
  document.body.append(dialog);

  return {
    unmount() {
      launcher.removeEventListener('click', open);
      handle?.unmount();
      dialog.remove();
      element.replaceChildren();
      delete element.dataset.chimeMounted;
    },
  };
}
