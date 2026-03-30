// Popup UI controller

const $ = (sel) => document.querySelector(sel);

const views = {
  notKeats: $('#not-keats'),
  ready: $('#ready'),
  progress: $('#progress'),
  complete: $('#complete'),
};

function showView(name) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  views[name]?.classList.remove('hidden');
}

function isMoodleCoursePage(url) {
  if (!url) return false;
  return /\/course\/view\.php/.test(url);
}

// ---------- Theme toggle ----------

function initTheme() {
  const saved = localStorage.getItem('keats-theme');
  if (saved === 'dark') {
    document.body.classList.add('dark');
    $('#theme-toggle').checked = true;
  } else {
    document.body.classList.remove('dark');
    $('#theme-toggle').checked = false;
  }
}

$('#theme-toggle').addEventListener('change', (e) => {
  if (e.target.checked) {
    document.body.classList.add('dark');
    localStorage.setItem('keats-theme', 'dark');
  } else {
    document.body.classList.remove('dark');
    localStorage.setItem('keats-theme', 'light');
  }
});

// ---------- Download path ----------

async function loadDownloadPath() {
  try {
    const data = await chrome.storage.local.get('downloadPath');
    const path = data.downloadPath || 'KEATS Downloads';
    $('#download-path').value = path;
    autoSizePath();
  } catch (e) {}
}

function autoSizePath() {
  const input = $('#download-path');
  if (input) input.style.width = Math.max(40, input.value.length * 7) + 'px';
}

$('#download-path').addEventListener('input', autoSizePath);
$('#download-path').addEventListener('change', () => {
  const val = $('#download-path').value.trim() || 'KEATS Downloads';
  $('#download-path').value = val;
  chrome.storage.local.set({ downloadPath: val });
  autoSizePath();
});

// ---------- Library ----------

async function loadLibrary() {
  try {
    const history = await sendBg({ type: 'GET_HISTORY' });
    const list = $('#library-list');
    const empty = $('#library-empty');
    const library = $('#library');

    if (!history || history.total === 0) {
      library.classList.add('hidden');
      return;
    }

    library.classList.remove('hidden');
    list.innerHTML = '';
    empty.classList.add('hidden');

    const courses = Object.entries(history.courses)
      .sort((a, b) => b[1].lastDownload - a[1].lastDownload);

    for (const [name, info] of courses) {
      const date = new Date(info.lastDownload);
      const dateStr = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const item = document.createElement('div');
      item.className = 'library-item';
      item.innerHTML = `
        <div class="library-item-info">
          <div class="library-item-name">${esc(name)}</div>
          <div class="library-item-meta">${info.count} files · ${dateStr}</div>
        </div>
        <button class="btn-text btn-clear-course" data-course="${esc(name)}">Clear</button>
      `;
      list.appendChild(item);
    }

    list.querySelectorAll('.btn-clear-course').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const course = e.target.getAttribute('data-course');
        await sendBg({ type: 'CLEAR_HISTORY', course });
        loadLibrary();
      });
    });
  } catch (e) {}
}

$('#btn-clear-all').addEventListener('click', async () => {
  await sendBg({ type: 'CLEAR_HISTORY' });
  loadLibrary();
});

// ---------- Init ----------

async function init() {
  initTheme();
  await loadDownloadPath();

  // Check if we already have an active download
  try {
    const status = await sendBg({ type: 'GET_STATUS' });
    if (status && (status.status === 'scanning' || status.status === 'downloading')) {
      showView('progress');
      updateProgress(status);
      return;
    }
    if (status && (status.status === 'complete' || status.status === 'cancelled' || status.status === 'error')) {
      showView('complete');
      updateComplete(status);
      return;
    }
  } catch (e) {}

  // Check current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!isMoodleCoursePage(tab?.url)) {
    showView('notKeats');
    loadLibrary();
    return;
  }

  // Scrape course info
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const h1 = document.querySelector('h1');
        const courseName = h1 ? h1.textContent.trim() : document.title.trim();
        const courseUrl = window.location.href.split('#')[0];
        const gridSections = [];
        const seen = {};
        const sectionLinks = document.querySelectorAll(
          'a[href*="course/section.php?id="], ' +
          'a[href*="course/view.php"][href*="section="], ' +
          '.grid-section a[href], .gridicon_link, #gridicons a[href]'
        );
        for (const link of sectionLinks) {
          const href = link.href.split('#')[0];
          const text = (link.textContent || '').trim().replace(/\s+/g, ' ');
          if (!seen[href] && text && text.length > 1 && !text.startsWith('Go to section')) {
            seen[href] = true;
            gridSections.push({ href, name: text });
          }
        }

        const inlineSectionsArr = [];
        const inlineSections = document.querySelectorAll(
          '#region-main .section.course-section[data-id], ' +
          '#region-main li[id^="section-"][data-id], ' +
          '#region-main .section.main[data-id]'
        );
        for (const sec of inlineSections) {
          const nameEl = sec.querySelector(
            'h3.sectionname, h3.section-title, .sectionname, ' +
            '.section-title a, .sectionhead h3, [data-for="section_title"]'
          );
          const name = nameEl ? nameEl.textContent.trim() : null;
          const sectionId = sec.getAttribute('data-id');
          const sectionNum = sec.getAttribute('data-number');
          if (!sectionId) continue;
          inlineSectionsArr.push({
            href: courseUrl + '#section-inline-' + sectionId,
            name: name || ('Section ' + (sectionNum || sectionId)),
            inline: true,
            sectionId,
          });
        }

        const tabSections = [];
        const tabs = document.querySelectorAll('.onetopic .nav-tabs .nav-link, .onetopic-tab-list a, ul.nav-tabs li a[href*="section="]');
        for (const tab of tabs) {
          const href = tab.href;
          const text = tab.textContent.trim();
          if (href && text && text.length > 0) tabSections.push({ href, name: text });
        }

        let sections, format;
        const counts = [
          { arr: inlineSectionsArr, fmt: 'topics' },
          { arr: gridSections, fmt: 'grid' },
          { arr: tabSections, fmt: 'onetopic' },
        ];
        counts.sort((a, b) => b.arr.length - a.arr.length);
        sections = counts[0].arr;
        format = counts[0].fmt;
        return { courseName, sections, courseUrl, format };
      },
    });

    const info = results[0]?.result;
    if (info && info.courseName && info.sections.length > 0) {
      $('#course-name').textContent = info.courseName;
      $('#section-count').textContent = info.sections.length;
      $('#path-course-name').textContent = info.courseName.substring(0, 30);
      showView('ready');
      window._courseInfo = info;
      window._tabId = tab.id;
    } else if (info && info.courseName) {
      $('#course-name').textContent = info.courseName;
      $('#section-count').textContent = '0';
      $('#path-course-name').textContent = info.courseName.substring(0, 30);
      showView('ready');
      window._courseInfo = info;
      window._courseInfo.sections = [{ href: info.courseUrl, name: info.courseName, inline: false }];
      window._tabId = tab.id;
    } else {
      showView('notKeats');
    }
  } catch (e) {
    showView('notKeats');
  }
  loadLibrary();

  // Check for new files
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      await sendBg({ type: 'CHECK_NEW_FILES', tabId: activeTab.id });
      const sessionData = await chrome.storage.session.get(`newFiles:${activeTab.id}`);
      const info = sessionData[`newFiles:${activeTab.id}`];
      if (info && info.count > 0) {
        const el = $('#new-files-badge');
        if (el) {
          el.textContent = `${info.count} new file${info.count > 1 ? 's' : ''} since last download`;
          el.classList.remove('hidden');
        }
      }
    }
  } catch (e) {}
}

// ---------- Download button ----------

$('#btn-download').addEventListener('click', async () => {
  const btn = $('#btn-download');
  btn.disabled = true;
  btn.textContent = 'Starting...';
  showView('progress');

  const downloadPath = $('#download-path').value.trim() || 'KEATS Downloads';
  chrome.storage.local.set({ downloadPath });

  await sendBg({
    type: 'START_DOWNLOAD',
    tabId: window._tabId,
    courseInfo: window._courseInfo,
    options: {
      materials: $('#opt-materials').checked,
      videos: $('#opt-videos').checked,
      captures: $('#opt-captures').checked,
      folders: $('#opt-folders').checked,
      optional: $('#opt-optional').checked,
      downloadPath,
    },
  });
});

// ---------- Cancel button ----------

$('#btn-cancel').addEventListener('click', async () => {
  try { await sendBg({ type: 'CANCEL' }); } catch (e) {}
  showView('ready');
  const btn = $('#btn-download');
  btn.disabled = false;
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
    Download All
  `;
  $('#btn-cancel').textContent = 'Cancel';
  $('#btn-cancel').disabled = false;
  loadLibrary();
});

// ---------- Done button ----------

$('#btn-done').addEventListener('click', () => {
  sendBg({ type: 'CANCEL' });
  showView('ready');
  const btn = $('#btn-download');
  btn.disabled = false;
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
    Download All
  `;
  $('#btn-cancel').textContent = 'Cancel';
  $('#btn-cancel').disabled = false;
  loadLibrary();
});

// ---------- Progress updates (push-based, no polling) ----------

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PROGRESS_UPDATE') {
    const s = msg.state;
    if (s.status === 'scanning' || s.status === 'downloading') {
      showView('progress');
      updateProgress(s);
    } else if (s.status === 'complete' || s.status === 'cancelled' || s.status === 'error') {
      showView('complete');
      updateComplete(s);
    }
  }
});

function updateProgress(s) {
  const statusBadge = $('#progress-status');
  const progressBar = $('#progress-bar');
  const progressCount = $('#progress-count');

  if (s.status === 'scanning') {
    statusBadge.textContent = 'Scanning';
    statusBadge.className = 'status-badge';
    progressBar.classList.add('scanning');
    const scanPct = s.totalSections > 0
      ? Math.round(s.scannedSections / s.totalSections * 100) : 0;
    progressBar.style.width = scanPct + '%';
    progressCount.textContent = s.totalSections > 0
      ? `${s.scannedSections} / ${s.totalSections} sections` : '';
  } else {
    progressBar.classList.remove('scanning');
    statusBadge.textContent = 'Downloading';
    statusBadge.className = 'status-badge downloading';
    const pct = s.totalFiles > 0
      ? Math.round((s.downloadedFiles + s.failedFiles) / s.totalFiles * 100) : 0;
    progressBar.style.width = pct + '%';
    progressCount.textContent = `${s.downloadedFiles + s.failedFiles} / ${s.totalFiles}`;
  }

  $('#current-file').textContent = s.currentFile || '';

  $('#log').innerHTML = s.log.map(line => {
    if (line.startsWith('Downloaded:')) return `<span class="log-success">${esc(line)}</span>`;
    if (line.startsWith('Failed:') || line.startsWith('Error:')) return `<span class="log-error">${esc(line)}</span>`;
    if (line.startsWith('Skipped')) return `<span class="log-info">${esc(line)}</span>`;
    if (line.startsWith('Course:') || line.startsWith('Sections:') || line.startsWith('Found') || line.startsWith('Done') || line.startsWith('Downloading'))
      return `<span class="log-info">${esc(line)}</span>`;
    return esc(line);
  }).join('\n');

  const lc = $('#log-container');
  lc.scrollTop = lc.scrollHeight;
}

function updateComplete(s) {
  const title = $('#complete-title');
  if (s.status === 'cancelled') title.textContent = 'Download Cancelled';
  else if (s.status === 'error') title.textContent = 'Download Error';
  else title.textContent = 'Download Complete';

  $('#stat-downloaded').textContent = s.downloadedFiles;
  $('#stat-failed').textContent = s.failedFiles;
  $('#stat-failed').parentElement.style.display = s.failedFiles > 0 ? 'flex' : 'none';

  const path = $('#download-path')?.value || 'KEATS Downloads';
  $('#save-path').innerHTML = `Saved to <strong>Downloads/${esc(path)}/</strong>`;
}

// ---------- Helpers ----------

function sendBg(msg) { return chrome.runtime.sendMessage(msg); }

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

init();
