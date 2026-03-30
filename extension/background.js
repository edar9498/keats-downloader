// Background service worker - orchestrates scraping and downloads
// Supports any Moodle-based LMS (KEATS, Moodle, etc.) + Echo360 lecture recordings

let state = {
  status: 'idle', // idle | scanning | downloading | complete | error | cancelled
  courseName: '',
  totalFiles: 0,
  downloadedFiles: 0,
  failedFiles: 0,
  currentFile: '',
  log: [],
  errors: [],
  sections: [],
  cancelled: false,
};

// (filename resolution is now done inline before each download)

// ---------- Message handling ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'START_DOWNLOAD':
      startDownload(msg.tabId, msg.courseInfo, msg.options);
      sendResponse({ ok: true });
      break;
    case 'GET_STATUS':
      sendResponse({ ...state });
      break;
    case 'CANCEL':
      if (state.status === 'scanning' || state.status === 'downloading') {
        state.cancelled = true;
        state.status = 'cancelled';
        chrome.downloads.setUiOptions({ enabled: true }).catch(() => {});
        broadcastProgress();
      } else {
        // Reset state when called from "Done"
        state = { status: 'idle', courseName: '', totalFiles: 0, downloadedFiles: 0,
          failedFiles: 0, currentFile: '', log: [], errors: [], sections: [], cancelled: false };
      }
      sendResponse({ ok: true });
      break;
  }
  return false;
});

// ---------- Resolve filename from URL ----------

async function resolveFilename(url) {
  try {
    const resp = await fetch(url, { method: 'GET', credentials: 'include', redirect: 'follow' });
    const cd = resp.headers.get('Content-Disposition') || '';
    // Abort the body - we only needed headers + final URL
    resp.body?.cancel();

    // Try Content-Disposition header first
    const match = cd.match(/filename\*?=["']?(?:UTF-8'')?([^"';\r\n]+)/i);
    if (match) {
      return sanitize(decodeURIComponent(match[1]));
    }

    // Fall back to final URL path
    const finalUrl = resp.url;
    const urlPath = new URL(finalUrl).pathname;
    const urlFilename = decodeURIComponent(urlPath.split('/').pop());
    if (urlFilename && urlFilename.includes('.') && !urlFilename.endsWith('.php')) {
      return sanitize(urlFilename);
    }
  } catch (e) {
    // Fetch failed - fall back
  }
  return null;
}

// ---------- Core workflow ----------

async function startDownload(_tabId, courseInfo, options = {}) {
  const doMaterials = options.materials !== false;
  const doVideos = options.videos === true;      // Kaltura videos in weekly sections
  const doCaptures = options.captures === true;  // Echo360 lecture captures
  const doFolders = options.folders !== false;
  const doOptional = options.optional === true;

  state = {
    status: 'scanning',
    courseName: courseInfo.courseName,
    totalFiles: 0,
    downloadedFiles: 0,
    failedFiles: 0,
    currentFile: '',
    log: [],
    errors: [],
    sections: [],
    cancelled: false,
  };

  const courseName = sanitize(courseInfo.courseName).substring(0, 80);
  const basePath = `KEATS Downloads/${courseName}/`;

  addLog(`Course: ${courseName}`);
  addLog(`Sections: ${courseInfo.sections.length}`);
  if (doVideos) addLog(`Echo360 video download enabled`);
  broadcastProgress();

  const tempTab = await chrome.tabs.create({ url: 'about:blank', active: false });
  const tempTabId = tempTab.id;

  try {
    // ==================== Phase 1: Scan sections for files ====================
    const allFiles = [];

    if (doMaterials) {
      for (let i = 0; i < courseInfo.sections.length; i++) {
        if (state.cancelled) break;

        const section = courseInfo.sections[i];
        const sectionName = sanitize(section.name);
        if (!sectionName || /^-+$/.test(sectionName)) continue;

        addLog(`Scanning ${i + 1}/${courseInfo.sections.length}: ${sectionName}`);
        broadcastProgress();

        let files;
        if (section.inline && section.sectionId) {
          // Topics format: sections are inline on the course page
          // Navigate to course page (only once), then scrape specific section
          const coursePageUrl = courseInfo.courseUrl.split('#')[0];
          const currentUrl = await getTabUrl(tempTabId);
          if (!currentUrl || !currentUrl.includes(coursePageUrl.split('?')[0])) {
            await navigateTab(tempTabId, coursePageUrl);
            await sleep(2000);
          }
          files = await executeScrape(tempTabId, scrapeInlineSection, section.sectionId, doOptional);
          await sleep(300); // Brief delay for topcoll sections to expand
        } else {
          // Grid format: navigate to separate section page
          await navigateTab(tempTabId, section.href);
          await sleep(1500);
          files = await executeScrape(tempTabId, scrapeSectionPage, doOptional);
        }

        // Expand folders
        const expandedFiles = [];
        for (const file of files) {
          if (state.cancelled) break;

          if (file.type === 'folder' && doFolders) {
            addLog(`  Expanding folder: ${file.name}`);
            await navigateTab(tempTabId, file.href);
            await sleep(1000);
            const folderFiles = await executeScrape(tempTabId, scrapeFolderPage);
            for (const ff of folderFiles) {
              ff.category = file.category;
              ff.folderName = file.name;
              expandedFiles.push(ff);
            }
          } else if (file.type === 'kaltura' && doVideos) {
            // Resolve Kaltura video download URL
            addLog(`  Resolving video: ${file.name}`);
            await navigateTab(tempTabId, file.href);
            await sleep(2000);

            // Step 1: Get entry ID from the KEATS page iframe
            const videoInfo = await executeScrape(tempTabId, scrapeKalturaVideo);

            if (videoInfo && videoInfo.entryId) {
              // Step 2: Navigate into the iframe URL to get a working KS
              const iframeSrc = await executeScrape(tempTabId, scrapeKalturaIframeSrc);
              if (iframeSrc) {
                await navigateTab(tempTabId, iframeSrc);
                await sleep(4000);
                const innerInfo = await executeScrape(tempTabId, scrapeKalturaKS);
                if (innerInfo && innerInfo.ksValues && innerInfo.ksValues.length > 0) {
                  if (innerInfo.partnerId) videoInfo.partnerId = innerInfo.partnerId;

                  // Try each KS to find one that works (some are domain-restricted)
                  let workingKs = null;
                  for (const ks of innerInfo.ksValues) {
                    try {
                      const testUrl = `https://cdnapisec.kaltura.com/api_v3/service/baseEntry/action/get?ks=${ks}&entryId=${videoInfo.entryId}&format=1`;
                      const resp = await fetch(testUrl);
                      const data = await resp.json();
                      if (data && data.id && !data.code) {
                        workingKs = ks;
                        break;
                      }
                    } catch (e) { /* try next */ }
                  }

                  if (workingKs) {
                    videoInfo.downloadUrl = `https://cdnapisec.kaltura.com/p/${videoInfo.partnerId}/sp/${videoInfo.partnerId}00/playManifest/entryId/${videoInfo.entryId}/format/download/protocol/https/ks/${workingKs}`;
                  }
                }
              }

              file.href = videoInfo.downloadUrl;
              file.type = 'kalturaDownload';
              expandedFiles.push(file);
            } else {
              addLog(`  Could not resolve video: ${file.name}`);
            }
          } else if (file.type !== 'folder' && file.type !== 'kaltura') {
            expandedFiles.push(file);
          }
        }

        for (const file of expandedFiles) {
          file.sectionName = sectionName;
          file.courseName = courseName;
        }

        allFiles.push(...expandedFiles);
        state.sections.push({ name: sectionName, fileCount: expandedFiles.length });
      }
    }

    // ==================== Phase 2: Scan Echo360 for videos ====================
    if (doCaptures && !state.cancelled) {
      addLog(`\nScanning for Echo360 lecture captures...`);
      broadcastProgress();

      // Find Echo360 LTI link on the main course page
      const coursePageUrl = courseInfo.courseUrl.split('#')[0];
      await navigateTab(tempTabId, coursePageUrl);
      await sleep(2000);

      const ltiLinks = await executeScrape(tempTabId, scrapeEcho360LTI);

      for (const lti of ltiLinks) {
        if (state.cancelled) break;

        addLog(`Checking LTI: ${lti.name}`);

        // Navigate to LTI page first to get the launch URL
        await navigateTab(tempTabId, lti.href);
        await sleep(2000);

        // The LTI view page opens a new window or has a launch link
        // Navigate to the launch URL which redirects to Echo360
        const launchUrl = lti.href.replace('/view.php', '/launch.php') +
          (lti.href.includes('?') ? '&' : '?') + 'triggerview=0';
        await navigateTab(tempTabId, launchUrl);
        await sleep(6000);

        const currentUrl = await getTabUrl(tempTabId);
        if (!currentUrl || !currentUrl.includes('echo360')) {
          if (!lti.isCandidate) addLog(`  Could not access Echo360`);
          continue;
        }

        addLog(`  Connected to Echo360`);

        // Get the Echo360 section ID from the URL
        const sectionMatch = currentUrl.match(/section\/([a-f0-9-]+)/);
        const echo360SectionId = sectionMatch ? sectionMatch[1] : null;

        if (!echo360SectionId) {
          addLog(`  Could not find Echo360 section ID`);
          continue;
        }

        // Fetch syllabus data via Echo360 API (runs in Echo360 page context)
        const syllabusData = await executeScrape(tempTabId, scrapeEcho360Syllabus, echo360SectionId);

        if (!syllabusData || syllabusData.length === 0) {
          addLog(`  No recordings found`);
          continue;
        }

        addLog(`Found ${syllabusData.length} Echo360 recordings`);

        // Get institution ID from the Echo360 page
        const institutionId = await executeScrape(tempTabId, () => {
          const match = document.body.innerHTML.match(/institutionId['":\s]+['"]([a-f0-9-]+)['"]/);
          return match ? match[1] : null;
        });

        for (const recording of syllabusData) {
          if (state.cancelled) break;
          if (!recording.mediaId || !recording.isAvailable) continue;

          // Navigate to the lesson classroom to trigger video loading and get CloudFront cookies
          if (recording.lessonId) {
            addLog(`  Loading: ${recording.name}`);
            await navigateTab(tempTabId, `https://${new URL(currentUrl).host}/lesson/${recording.lessonId}/classroom`);
            await sleep(4000);

            // Capture the MP4 URL from the page (the player loads it)
            const videoUrl = await executeScrape(tempTabId, scrapeEcho360VideoUrl, recording.mediaId, institutionId);

            if (videoUrl) {
              // Format a nice date-based name
              const dateStr = recording.date || 'Unknown Date';

              allFiles.push({
                name: `${recording.name} - ${dateStr}`,
                href: videoUrl,
                category: 'Lectures',
                sectionName: 'Lecture Recordings',
                courseName: courseName,
                type: 'echo360',
              });
            } else {
              addLog(`    Could not get video URL`);
            }
          }
        }
      }
    }

    // Remove temp tab
    try { await chrome.tabs.remove(tempTabId); } catch (e) {}

    // ==================== Phase 3: Download files ====================
    const downloadable = allFiles.filter(f =>
      f.type === 'resource' || f.type === 'folderFile' || f.type === 'echo360' || f.type === 'kalturaDownload'
    );

    state.totalFiles = downloadable.length;
    state.status = 'downloading';
    addLog(`\nDownloading ${downloadable.length} files...`);
    broadcastProgress();

    if (state.cancelled) return;

    // Hide Chrome's download bar/bubble during bulk download
    try { await chrome.downloads.setUiOptions({ enabled: false }); } catch (e) {}

    for (let i = 0; i < downloadable.length; i++) {
      if (state.cancelled) break;

      const file = downloadable[i];
      state.currentFile = file.name;
      broadcastProgress();

      try {
        await downloadWithRetry(file, basePath, 3);
        state.downloadedFiles++;
        addLog(`Downloaded: ${file.name}`);
      } catch (err) {
        state.failedFiles++;
        state.errors.push({ name: file.name, error: err.message || String(err) });
        addLog(`Failed: ${file.name} - ${err.message || err}`);
      }
      broadcastProgress();
    }

    // Re-enable Chrome's download UI
    try { await chrome.downloads.setUiOptions({ enabled: true }); } catch (e) {}

    state.status = state.cancelled ? 'cancelled' : 'complete';
    state.currentFile = '';
    addLog(`\nDone! ${state.downloadedFiles} downloaded, ${state.failedFiles} failed.`);
    broadcastProgress();

  } catch (err) {
    state.status = 'error';
    addLog(`Error: ${err.message}`);
    broadcastProgress();
    try { await chrome.tabs.remove(tempTabId); } catch (e) {}
    try { await chrome.downloads.setUiOptions({ enabled: true }); } catch (e) {}
  }
}

// ==================== Scraping functions (injected into tabs) ====================

function scrapeSectionPage(includeOptional) {
  const results = [];
  let currentCategory = 'other';
  let isOptional = false;

  const activities = document.querySelectorAll('.activity');
  for (const el of activities) {
    if (el.classList.contains('modtype_label')) {
      const raw = el.innerText.trim();
      if (!raw || /^-+$/.test(raw) || raw.length < 3) continue;

      const firstLine = raw.split('\n')[0].trim();
      if (firstLine.length < 3 || firstLine.length > 120) continue;

      const fl = firstLine.toUpperCase();

      // Detect optional/mandatory markers
      if (fl.includes('OPTIONAL')) { isOptional = true; }
      if (fl.includes('MANDATORY') || fl.includes('REQUIRED') || fl.includes('CORE')) { isOptional = false; }

      if (fl.includes('LECTURE MATERIAL') || fl.includes('LECTURE SLIDES') ||
          fl.includes('LECTURE PODCAST') ||
          (fl.includes('WEEK') && fl.includes('LECTURE'))) {
        currentCategory = 'Lectures';
      } else if (fl.includes('TUTORIAL MATERIAL') || fl.includes('TUTORIAL SLIDES') ||
                 fl.includes('TUTORIAL PRE-READING') || fl.includes('TUTORIAL PREPARATION') ||
                 fl.includes('SEMINAR MATERIAL')) {
        currentCategory = 'Tutorials';
      } else {
        const isHeading = firstLine.length <= 80 &&
          /^[A-Z]/.test(firstLine) &&
          !firstLine.includes('. ') &&
          firstLine.split(' ').length <= 12;

        if (isHeading) {
          currentCategory = firstLine.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 60).trim();
        }
      }
      continue;
    }

    // Skip optional resources unless user opted in
    if (isOptional && !includeOptional) continue;

    if (el.classList.contains('modtype_resource')) {
      const link = el.querySelector('a[href*="/mod/resource/"]');
      if (!link) continue;
      const name = el.innerText.trim().replace(/\n/g, ' ').replace(/\s*(File|Folder)\s*/g, '').trim();
      if (!name || name.length < 2) continue;
      results.push({ name, href: link.href, category: currentCategory, type: 'resource', optional: isOptional });
    }

    if (el.classList.contains('modtype_folder')) {
      const link = el.querySelector('a[href*="/mod/folder/"]');
      if (!link) continue;
      const name = el.innerText.trim().replace(/\n/g, ' ').replace(/\s*(File|Folder)\s*/g, '').trim();
      if (!name || name.length < 2) continue;
      results.push({ name, href: link.href, category: currentCategory, type: 'folder', optional: isOptional });
    }

    // Kaltura video resources
    if (el.classList.contains('modtype_kalvidres') || el.classList.contains('modtype_kalvidpres')) {
      const link = el.querySelector('a[href*="/mod/kalvid"]');
      if (!link) continue;
      const name = el.innerText.trim().replace(/\n/g, ' ')
        .replace(/\s*Kaltura Video (Resource|Presentation)\s*/gi, '').trim();
      if (!name || name.length < 2) continue;
      results.push({ name, href: link.href, category: currentCategory, type: 'kaltura', optional: isOptional });
    }
  }

  return results;
}

function scrapeInlineSection(sectionId, includeOptional) {
  // Find the section — try multiple selectors for different Moodle formats
  let section = document.querySelector(
    `.section.course-section[data-id="${sectionId}"], ` +
    `.section.main[data-id="${sectionId}"], ` +
    `li[id^="section-"][data-id="${sectionId}"]`
  );
  if (!section) return [];

  // For topcoll format, expand the section if collapsed
  const toggle = section.querySelector('.toggle_closed');
  if (toggle) { toggle.click(); }

  const results = [];
  let currentCategory = 'other';
  let isOptional = false;

  // Get activities — look in the section and any toggled content divs inside it
  const activities = section.querySelectorAll('.activity');
  for (const el of activities) {
    if (el.classList.contains('modtype_label')) {
      const raw = el.innerText.trim();
      if (!raw || /^-+$/.test(raw) || raw.length < 3) continue;
      const firstLine = raw.split('\n')[0].trim();
      if (firstLine.length < 3 || firstLine.length > 120) continue;
      const fl = firstLine.toUpperCase();

      if (fl.includes('OPTIONAL')) { isOptional = true; }
      if (fl.includes('MANDATORY') || fl.includes('REQUIRED') || fl.includes('CORE')) { isOptional = false; }

      if (fl.includes('LECTURE MATERIAL') || fl.includes('LECTURE SLIDES') ||
          fl.includes('LECTURE PODCAST') ||
          (fl.includes('WEEK') && fl.includes('LECTURE'))) {
        currentCategory = 'Lectures';
      } else if (fl.includes('TUTORIAL MATERIAL') || fl.includes('TUTORIAL SLIDES') ||
                 fl.includes('TUTORIAL PRE-READING') || fl.includes('TUTORIAL PREPARATION') ||
                 fl.includes('SEMINAR MATERIAL')) {
        currentCategory = 'Tutorials';
      } else {
        const isHeading = firstLine.length <= 80 &&
          /^[A-Z]/.test(firstLine) &&
          !firstLine.includes('. ') &&
          firstLine.split(' ').length <= 12;
        if (isHeading) {
          currentCategory = firstLine.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 60).trim();
        }
      }
      continue;
    }

    if (isOptional && !includeOptional) continue;

    if (el.classList.contains('modtype_resource')) {
      const link = el.querySelector('a[href*="/mod/resource/"]');
      if (!link) continue;
      const name = el.innerText.trim().replace(/\n/g, ' ').replace(/\s*(File|Folder)\s*/g, '').trim();
      if (!name || name.length < 2) continue;
      results.push({ name, href: link.href, category: currentCategory, type: 'resource' });
    }

    if (el.classList.contains('modtype_folder')) {
      const link = el.querySelector('a[href*="/mod/folder/"]');
      if (!link) continue;
      const name = el.innerText.trim().replace(/\n/g, ' ').replace(/\s*(File|Folder)\s*/g, '').trim();
      if (!name || name.length < 2) continue;
      results.push({ name, href: link.href, category: currentCategory, type: 'folder' });
    }
  }

  return results;
}

function scrapeFolderPage() {
  const results = [];

  let links = document.querySelectorAll('.fp-filename-icon a[href*="pluginfile.php"]');
  if (links.length === 0) {
    links = document.querySelectorAll('#region-main a[href*="pluginfile.php"]');
  }
  if (links.length === 0) {
    links = document.querySelectorAll('.filemanager a[href*="pluginfile.php"], .foldertree a[href*="pluginfile.php"]');
  }

  for (const link of links) {
    const href = link.href;
    const urlPath = new URL(href).pathname;
    const name = decodeURIComponent(urlPath.split('/').pop());
    if (name && name.length > 1) {
      results.push({ name, href, type: 'folderFile' });
    }
  }

  return results;
}

function scrapeKalturaVideo() {
  // Step 1: Find the Kaltura iframe and extract entry ID
  const iframe = document.querySelector('iframe.kaltura-player-iframe, iframe#contentframe, iframe[src*="kalvidres"]');
  if (!iframe || !iframe.src) return null;

  const decodedSrc = decodeURIComponent(iframe.src);
  const entryMatch = decodedSrc.match(/entryid\/([^\/&]+)/i) ||
                     decodedSrc.match(/entry_id[=\/]([^\/&]+)/i);
  if (!entryMatch) return null;

  const entryId = entryMatch[1];

  // Step 2: Try to find partner ID and KS from the page or iframe
  // These are often in script tags or data attributes
  let partnerId = '2368101'; // KEATS default
  let ks = null;

  // Check page scripts for Kaltura config
  const scripts = document.querySelectorAll('script');
  for (const s of scripts) {
    const text = s.textContent;
    if (text.includes('partnerId')) {
      const pMatch = text.match(/partnerId['":\s]+(\d+)/);
      if (pMatch) partnerId = pMatch[1];
    }
    if (text.includes('"ks"')) {
      const kMatch = text.match(/"ks"\s*:\s*"([^"]+)"/);
      if (kMatch) ks = kMatch[1];
    }
  }

  // Step 3: Construct direct download URL
  // Kaltura's /format/download/ endpoint returns a direct MP4
  let downloadUrl = `https://cdnapisec.kaltura.com/p/${partnerId}/sp/${partnerId}00/playManifest/entryId/${entryId}/format/download/protocol/https`;
  if (ks) {
    downloadUrl += `/ks/${ks}`;
  }

  return {
    entryId,
    partnerId,
    downloadUrl,
    hasKs: !!ks,
  };
}

function scrapeKalturaIframeSrc() {
  const iframe = document.querySelector('iframe.kaltura-player-iframe, iframe#contentframe, iframe[src*="kalvidres"]');
  return iframe ? iframe.src : null;
}

function scrapeKalturaKS() {
  // When navigated directly to the KAF page, multiple KS values exist in script tags.
  // Some are domain-restricted and won't work for API calls.
  // Collect all unique KS values so the caller can try each.
  const ksValues = [];
  let partnerId = null;

  const scripts = document.querySelectorAll('script');
  for (const s of scripts) {
    const text = s.textContent;
    // Find all KS strings
    const matches = text.matchAll(/"ks"\s*:\s*"([^"]+)"/g);
    for (const m of matches) {
      if (!ksValues.includes(m[1])) ksValues.push(m[1]);
    }
    if (text.includes('partnerId') && !partnerId) {
      const pMatch = text.match(/partnerId['":\s]+(\d+)/);
      if (pMatch) partnerId = pMatch[1];
    }
  }

  // Also check for KS in the page source via other patterns
  const bodyText = document.body.innerHTML;
  const altMatches = bodyText.matchAll(/["']ks["']\s*:\s*["']([^"']+)["']/g);
  for (const m of altMatches) {
    if (!ksValues.includes(m[1])) ksValues.push(m[1]);
  }

  return { ksValues, partnerId };
}

function scrapeEcho360LTI() {
  // Find LTI links that look like lecture capture
  const results = [];

  // Check all LTI activities
  const activities = document.querySelectorAll('.activity.modtype_lti');
  for (const act of activities) {
    const actLink = act.querySelector('a[href*="/mod/lti/"]');
    if (!actLink) continue;

    const text = (act.getAttribute('data-activityname') || act.innerText || '').toLowerCase();
    const href = actLink.href;

    // Match common lecture capture naming patterns
    if (text.includes('lecture capture') || text.includes('echo360') ||
        text.includes('recording') || text.includes('lecture recording')) {
      results.push({
        name: act.getAttribute('data-activityname') || actLink.textContent.trim() || 'Lecture Capture',
        href: href,
      });
    }
  }

  // If no obvious matches, include all LTI links as candidates
  // (the background will check if they redirect to Echo360)
  if (results.length === 0) {
    for (const act of activities) {
      const actLink = act.querySelector('a[href*="/mod/lti/"]');
      if (actLink) {
        results.push({
          name: act.getAttribute('data-activityname') || actLink.textContent.trim() || 'LTI Activity',
          href: actLink.href,
          isCandidate: true, // might not be Echo360
        });
      }
    }
  }

  return results;
}

function scrapeEcho360Section() {
  // Check if current page is Echo360
  const url = window.location.href;
  if (!url.includes('echo360')) return [];

  const rows = document.querySelectorAll('.class-row');
  const results = [];
  for (const row of rows) {
    results.push({
      text: row.textContent.trim().substring(0, 200),
    });
  }
  return results;
}

function scrapeEcho360VideoUrl(mediaId, institutionId) {
  // Try to find the MP4 URL from the player page
  // Method 1: Check video elements
  const videos = document.querySelectorAll('video');
  for (const v of videos) {
    if (v.src && v.src.includes('.mp4')) return v.src;
    const sources = v.querySelectorAll('source');
    for (const s of sources) {
      if (s.src && s.src.includes('.mp4')) return s.src;
    }
  }

  // Method 2: Construct from known pattern
  // Echo360 MP4 URL pattern: https://content.echo360.org.uk/0000.{institutionId}/{mediaId}/1/s2q1.mp4
  if (mediaId && institutionId) {
    const host = window.location.hostname.replace('echo360', 'content.echo360');
    return `https://${host}/0000.${institutionId}/${mediaId}/1/s2q1.mp4`;
  }

  // Method 3: Check performance entries for MP4 URLs
  if (window.performance && window.performance.getEntries) {
    const entries = window.performance.getEntries();
    for (const entry of entries) {
      if (entry.name && entry.name.includes('.mp4') && entry.name.includes(mediaId)) {
        return entry.name;
      }
    }
  }

  return null;
}

function scrapeEcho360Syllabus(sectionId) {
  // Fetch Echo360 syllabus API from within the Echo360 page context
  return fetch(`/section/${sectionId}/syllabus`, { credentials: 'include' })
    .then(r => r.json())
    .then(data => {
      return (data.data || []).map(item => {
        const lesson = item.lesson;
        if (!lesson || !lesson.hasVideo) return null;

        const media = lesson.medias && lesson.medias[0];
        if (!media || !media.isAvailable) return null;

        const startDate = lesson.lesson?.timing?.start;
        const dateStr = startDate
          ? new Date(startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
          : null;

        return {
          name: lesson.lesson?.displayName || 'Lecture',
          lessonId: lesson.lesson?.id,
          mediaId: media.id,
          isAvailable: media.isAvailable,
          date: dateStr,
        };
      }).filter(Boolean);
    })
    .catch(() => []);
}

// ==================== Download with retry ====================

async function downloadWithRetry(file, basePath, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await downloadSingleFile(file, basePath);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        addLog(`  Retry ${attempt}/${maxRetries - 1} for: ${file.name}`);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

// ==================== Download handler ====================

async function downloadSingleFile(file, basePath) {
  // Build directory path
  let dirPath = basePath;

  if (file.sectionName) {
    dirPath += `${sanitize(file.sectionName)}/`;
  }

  if (file.category && file.category !== 'other') {
    dirPath += `${file.category}/`;
  }

  if (file.folderName) {
    dirPath += `${sanitize(file.folderName)}/`;
  }

  // Build download URL
  let url = file.href;
  if (file.type === 'resource') {
    const sep = url.includes('?') ? '&' : '?';
    url = url + sep + 'redirect=1';
  }

  // Resolve the actual filename from the server
  let filename;
  if (file.type === 'folderFile') {
    const urlPath = new URL(file.href).pathname;
    filename = sanitize(decodeURIComponent(urlPath.split('/').pop()));
  } else if (file.type === 'kalturaDownload' || file.type === 'echo360') {
    // Video files - use the activity name + .mp4
    filename = sanitize(file.name) + '.mp4';
  } else {
    filename = await resolveFilename(url);
  }

  if (!filename) {
    filename = sanitize(file.name) || 'download';
  }

  const fullPath = dirPath + filename;

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url, filename: fullPath, saveAs: false, conflictAction: 'uniquify' },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (downloadId === undefined) {
          reject(new Error('Download failed to start'));
          return;
        }

        const listener = (delta) => {
          if (delta.id !== downloadId) return;
          if (delta.state) {
            if (delta.state.current === 'complete') {
              chrome.downloads.onChanged.removeListener(listener);
              resolve();
            } else if (delta.state.current === 'interrupted') {
              chrome.downloads.onChanged.removeListener(listener);
              reject(new Error(delta.error?.current || 'Download interrupted'));
            }
          }
        };

        chrome.downloads.onChanged.addListener(listener);

        setTimeout(() => {
          chrome.downloads.onChanged.removeListener(listener);
          reject(new Error('Download timeout'));
        }, 120000);
      }
    );
  });
}

// ==================== Execute scraping in a tab ====================

async function executeScrape(tabId, func, ...args) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  });
  return results[0]?.result || [];
}

// ==================== Helpers ====================

function navigateTab(tabId, url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(); // Resolve anyway after timeout
    }, 30000);

    chrome.tabs.update(tabId, { url }, () => {
      if (chrome.runtime.lastError) {
        clearTimeout(timeout);
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const listener = (id, info) => {
        if (id === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeout);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

async function getTabUrl(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return tab.url;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitize(name) {
  return name.replace(/[/\\?%*:|"<>]/g, '-').trim().replace(/\.+$/, '');
}

function addLog(msg) {
  state.log.push(msg);
  if (state.log.length > 300) {
    state.log = state.log.slice(-200);
  }
}

function broadcastProgress() {
  chrome.runtime.sendMessage({ type: 'PROGRESS_UPDATE', state: { ...state } }).catch(() => {});
}

// Expose internals for testing (no-op in Chrome extension context)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sanitize, addLog, sleep, downloadWithRetry,
    scrapeSectionPage, scrapeInlineSection, scrapeFolderPage,
    scrapeEcho360LTI, isMoodleCoursePage: undefined,
    get state() { return state; },
    set state(s) { state = s; },
  };
}
