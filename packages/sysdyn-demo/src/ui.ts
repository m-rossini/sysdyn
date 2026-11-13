export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Small circular "?" control that carries the help text inline. */
export function qIcon(title: string): string {
  const safe = escapeHtml(title);
  return `<span class="q" role="button" tabindex="0" data-help="${safe}" title="${safe}" aria-label="Help">?</span>`;
}

export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.01 || abs >= 1_000_000)) return value.toExponential(2);
  return value.toFixed(digits).replace(/\.?0+$/, '') || '0';
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'unknown';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(then).toLocaleDateString();
}

export function download(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toastHost(): HTMLElement {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    host.className = 'toasts';
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  return host;
}

export function toast(message: string, kind: 'info' | 'success' | 'error' = 'info', timeout = 4200): void {
  const node = document.createElement('div');
  node.className = `toast toast-${kind}`;
  node.textContent = message;
  toastHost().appendChild(node);
  window.setTimeout(() => {
    node.classList.add('toast-out');
    window.setTimeout(() => node.remove(), 220);
  }, timeout);
}

let popover: HTMLDivElement | null = null;

function helpPopover(): HTMLDivElement {
  if (popover) return popover;
  popover = document.createElement('div');
  popover.className = 'help-pop';
  popover.setAttribute('role', 'tooltip');
  popover.hidden = true;
  document.body.appendChild(popover);
  return popover;
}

export function showHelp(anchor: HTMLElement, text: string): void {
  const pop = helpPopover();
  pop.textContent = text;
  pop.hidden = false;
  const rect = anchor.getBoundingClientRect();
  pop.style.width = `${Math.min(340, window.innerWidth - 24)}px`;
  const popRect = pop.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - popRect.width / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - popRect.width - 12));
  let top = rect.bottom + 8;
  if (top + popRect.height > window.innerHeight - 12) {
    top = Math.max(12, rect.top - popRect.height - 8);
  }
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

export function hideHelp(): void {
  if (popover) popover.hidden = true;
}

/**
 * Delegated binding for every `.q` help control inside `root`.
 * Returns a cleanup function so views can detach global listeners on unmount.
 */
export function bindHelp(root: HTMLElement): () => void {
  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest('.q') : null;
    if (!(target instanceof HTMLElement)) return;
    const text = target.dataset.help;
    if (!text) return;
    event.preventDefault();
    event.stopPropagation();
    showHelp(target, text);
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains('q')) return;
    const text = target.dataset.help;
    if (!text) return;
    event.preventDefault();
    event.stopPropagation();
    showHelp(target, text);
  };
  const onDocumentClick = (event: MouseEvent) => {
    if (!popover || popover.hidden) return;
    const target = event.target;
    if (target instanceof Node && (popover.contains(target) || (target instanceof Element && target.closest('.q')))) return;
    hideHelp();
  };
  const onDocumentKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') hideHelp();
  };

  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeydown);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onDocumentKey);

  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKeydown);
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onDocumentKey);
    hideHelp();
  };
}
