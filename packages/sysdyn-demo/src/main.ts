import './styles.css';
import { LocalModelStore } from './store';
import { renderLibrary } from './library';
import { renderWorkspace } from './workspace';
import { toast } from './ui';

const store = new LocalModelStore();

const app = document.getElementById('app');
if (!app) throw new Error('Missing #app mount point');

app.innerHTML = `<header class="appbar">
  <a class="brand" href="#/models">
    <span class="brand-mark" aria-hidden="true">Σ</span>
    <span class="brand-text">
      <strong>SysDyn</strong>
      <small>model library &amp; simulation workspace</small>
    </span>
  </a>
  <nav class="appnav" aria-label="Main">
    <a class="nav-link active" data-nav="models" href="#/models">Models</a>
    <span class="nav-pill" id="navCount"></span>
  </nav>
</header>
<main class="view" id="view"></main>`;

const viewEl = document.getElementById('view');
const navCountEl = document.getElementById('navCount');
if (!viewEl || !navCountEl) throw new Error('Missing app shell elements');
const view: HTMLElement = viewEl;
const navCount: HTMLElement = navCountEl;

function updateNav(): void {
  const count = store.list().length;
  navCount.textContent = `${count} model${count === 1 ? '' : 's'}`;
  const onLibrary = !location.hash.startsWith('#/models/');
  document.querySelectorAll<HTMLElement>('[data-nav]').forEach(link => {
    link.classList.toggle('active', onLibrary && link.dataset.nav === 'models');
  });
}

let cleanup: (() => void) | null = null;

function showLibrary(): void {
  view.innerHTML = '';
  cleanup = renderLibrary(view, store);
}

function renderRoute(): void {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  updateNav();

  const raw = location.hash.replace(/^#/, '');
  if (!raw || raw === '/' || raw === '/models' || raw === '/models/') {
    if (raw !== '/models') history.replaceState(null, '', '#/models');
    showLibrary();
    return;
  }

  const match = raw.match(/^\/models\/(.+)$/);
  if (!match) {
    history.replaceState(null, '', '#/models');
    toast('That route does not exist — showing the model library.', 'info');
    showLibrary();
    return;
  }

  let id = match[1];
  try {
    id = decodeURIComponent(id);
  } catch {
    // Keep the raw id if it is not valid percent-encoding.
  }

  if (!store.get(id)) {
    history.replaceState(null, '', '#/models');
    toast(`Model “${id}” was not found.`, 'error');
    showLibrary();
    return;
  }

  view.innerHTML = '';
  let handledMissing = false;
  const workspaceCleanup = renderWorkspace(view, store, id, {
    missing: () => {
      handledMissing = true;
      history.replaceState(null, '', '#/models');
      toast(`Model “${id}” was not found.`, 'error');
      showLibrary();
    },
  });
  if (!handledMissing) cleanup = workspaceCleanup;
}

window.addEventListener('hashchange', renderRoute);
window.addEventListener('sysdyn:models-changed', updateNav);

renderRoute();
