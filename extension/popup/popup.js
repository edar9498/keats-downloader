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
  } else if (saved === 'light') {
    document.body.classList.remove('dark');
    $('#theme-toggle').checked = false;
  } else {
    // Default to light
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

// ---------- Init ----------

async function init() {
  initTheme();

  // Check if we already have an active download
  try {
    const status = await sendBg({ type: 'GET_STATUS' });
    if (status && (status.status === 'scanning' || status.status === 'downloading')) {
      showView('progress');
      updateProgress(status);
      return;
    }
    if (status && status.status === 'complete') {
      showView('complete');
      updateComplete(status);
      return;
    }
  } catch (e) { /* no active status */ }

  // Check current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!isMoodleCoursePage(tab?.url)) {
    showView('notKeats');
    return;
  }

  // Scrape course info - handles BOTH grid format (section links) and topics format (inline sections)
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const h1 = document.querySelector('h1');
        const courseName = h1 ? h1.textContent.trim() : document.title.trim();
        const courseUrl = window.location.href.split('#')[0];
        // Method 1: Grid format - sections are links to separate pages
        const gridSections = [];
        const seen = {};
        const sectionLinks = document.querySelectorAll('a[href*="course/section.php?id="]');
        for (const link of sectionLinks) {
          const href = link.href.split('#')[0];
          const text = link.textContent.trim();
          if (!seen[href] && text && !text.startsWith('Go to section')) {
            seen[href] = true;
            gridSections.push({ href, name: text });
          }
        }

        // Method 2: Topics/weekly/topcoll format - sections are inline on the page
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

        // Method 3: Onetopic format - sections as tabs
        const tabSections = [];
        const tabs = document.querySelectorAll('.onetopic .nav-tabs .nav-link, .onetopic-tab-list a, ul.nav-tabs li a[href*="section="]');
        for (const tab of tabs) {
          const href = tab.href;
          const text = tab.textContent.trim();
          if (href && text && text.length > 0) {
            tabSections.push({ href, name: text });
          }
        }

        // Use whichever method found the most sections
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
      showView('ready');
      window._courseInfo = info;
      window._tabId = tab.id;
    } else if (info && info.courseName) {
      // Course page found but no sections detected — still allow download attempt
      // The page might have activities directly without sections
      $('#course-name').textContent = info.courseName;
      $('#section-count').textContent = '0';
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
}

// ---------- Download button ----------

$('#btn-download').addEventListener('click', async () => {
  const btn = $('#btn-download');
  btn.disabled = true;
  btn.textContent = 'Checking settings...';

  // Test if Chrome will show a save dialog (user has "Ask where to save" enabled)
  const saveAsEnabled = await checkSaveAsSetting();
  if (saveAsEnabled) {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Download All
    `;
    showSaveAsWarning();
    return;
  }

  btn.textContent = 'Starting...';
  showView('progress');

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
    },
  });
});

async function checkSaveAsSetting() {
  // Download a tiny data URL and see if it completes immediately or gets user-prompted
  return new Promise((resolve) => {
    const dataUrl = 'data:text/plain;base64,dGVzdA=='; // "test"
    chrome.downloads.download(
      { url: dataUrl, filename: '.keats-test-delete-me.tmp', saveAs: false, conflictAction: 'overwrite' },
      (id) => {
        if (chrome.runtime.lastError || id === undefined) {
          resolve(false); // Can't tell, assume ok
          return;
        }
        let settled = false;
        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            // If it hasn't completed in 500ms, the save dialog is probably showing
            chrome.downloads.cancel(id);
            chrome.downloads.erase({ id });
            resolve(true);
          }
        }, 500);

        const listener = (delta) => {
          if (delta.id !== id) return;
          if (delta.state && delta.state.current === 'complete') {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              chrome.downloads.onChanged.removeListener(listener);
              // Clean up the test file
              chrome.downloads.removeFile(id);
              chrome.downloads.erase({ id });
              resolve(false);
            }
          }
        };
        chrome.downloads.onChanged.addListener(listener);
      }
    );
  });
}

function showSaveAsWarning() {
  let warning = $('#save-as-warning');
  if (!warning) {
    warning = document.createElement('div');
    warning.id = 'save-as-warning';
    warning.className = 'warning-banner';
    warning.innerHTML = `
      <p><strong>Chrome will ask where to save each file.</strong></p>
      <p>To fix this, disable "Ask where to save each file" in
      <a href="#" id="open-chrome-downloads">chrome://settings/downloads</a></p>
    `;
    const readyCard = $('#ready');
    readyCard.insertBefore(warning, $('#btn-download'));

    $('#open-chrome-downloads').addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'chrome://settings/downloads' });
    });
  }
  warning.classList.remove('hidden');
}

// ---------- Cancel button ----------

$('#btn-cancel').addEventListener('click', async () => {
  await sendBg({ type: 'CANCEL' });
  $('#btn-cancel').textContent = 'Cancelling...';
  $('#btn-cancel').disabled = true;
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
  const cancelBtn = $('#btn-cancel');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.disabled = false;
});

// ---------- Progress updates ----------

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
    const scanPct = s.totalSections > 0
      ? Math.round(s.scannedSections / s.totalSections * 100) : 0;
    progressBar.style.width = scanPct + '%';
    progressCount.textContent = s.totalSections > 0
      ? `${s.scannedSections} / ${s.totalSections} sections` : '';
  } else {
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
}

// ---------- Helpers ----------

function sendBg(msg) { return chrome.runtime.sendMessage(msg); }

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

init();
