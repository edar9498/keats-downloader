// Tests for DOM scraping functions (runs in jsdom)
const { createChromeMock } = require('./chrome-mock');
global.chrome = createChromeMock();

// jsdom doesn't implement innerText — polyfill it via textContent
Object.defineProperty(HTMLElement.prototype, 'innerText', {
  get() { return this.textContent; },
  set(v) { this.textContent = v; },
  configurable: true,
});

const bg = require('../extension/background');

function buildSectionHTML(activities) {
  return `
    <div id="region-main">
      ${activities.map(a => `
        <div class="activity ${a.class}">
          ${a.inner}
        </div>
      `).join('')}
    </div>
  `;
}

describe('scrapeSectionPage', () => {
  test('extracts resource links', () => {
    document.body.innerHTML = buildSectionHTML([
      {
        class: 'modtype_resource',
        inner: '<a href="https://keats.kcl.ac.uk/mod/resource/view.php?id=123">Lecture 1 Slides</a>',
      },
    ]);
    const results = bg.scrapeSectionPage(false);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Lecture 1 Slides');
    expect(results[0].type).toBe('resource');
    expect(results[0].href).toContain('/mod/resource/');
  });

  test('extracts folder links', () => {
    document.body.innerHTML = buildSectionHTML([
      {
        class: 'modtype_folder',
        inner: '<a href="https://keats.kcl.ac.uk/mod/folder/view.php?id=456">Week 2 Materials</a>',
      },
    ]);
    const results = bg.scrapeSectionPage(false);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Week 2 Materials');
    expect(results[0].type).toBe('folder');
  });

  test('detects category from labels', () => {
    document.body.innerHTML = buildSectionHTML([
      {
        class: 'modtype_label',
        inner: '<div>Lecture Materials</div>',
      },
      {
        class: 'modtype_resource',
        inner: '<a href="https://keats.kcl.ac.uk/mod/resource/view.php?id=1">Slides.pdf</a>',
      },
    ]);
    const results = bg.scrapeSectionPage(false);
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('Lectures');
  });

  test('detects tutorial category', () => {
    document.body.innerHTML = buildSectionHTML([
      {
        class: 'modtype_label',
        inner: '<div>Tutorial Materials</div>',
      },
      {
        class: 'modtype_resource',
        inner: '<a href="https://keats.kcl.ac.uk/mod/resource/view.php?id=2">Tutorial Sheet</a>',
      },
    ]);
    const results = bg.scrapeSectionPage(false);
    expect(results[0].category).toBe('Tutorials');
  });

  test('skips optional resources when includeOptional is false', () => {
    document.body.innerHTML = buildSectionHTML([
      {
        class: 'modtype_label',
        inner: '<div>Optional Reading</div>',
      },
      {
        class: 'modtype_resource',
        inner: '<a href="https://keats.kcl.ac.uk/mod/resource/view.php?id=3">Extra Paper</a>',
      },
    ]);
    const results = bg.scrapeSectionPage(false);
    expect(results).toHaveLength(0);
  });

  test('includes optional resources when includeOptional is true', () => {
    document.body.innerHTML = buildSectionHTML([
      {
        class: 'modtype_label',
        inner: '<div>Optional Reading</div>',
      },
      {
        class: 'modtype_resource',
        inner: '<a href="https://keats.kcl.ac.uk/mod/resource/view.php?id=3">Extra Paper</a>',
      },
    ]);
    const results = bg.scrapeSectionPage(true);
    expect(results).toHaveLength(1);
    expect(results[0].optional).toBe(true);
  });

  test('skips labels with only dashes', () => {
    document.body.innerHTML = buildSectionHTML([
      {
        class: 'modtype_label',
        inner: '<div>-----</div>',
      },
      {
        class: 'modtype_resource',
        inner: '<a href="https://keats.kcl.ac.uk/mod/resource/view.php?id=4">File.pdf</a>',
      },
    ]);
    const results = bg.scrapeSectionPage(false);
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('other');
  });

  test('detects Kaltura video resources', () => {
    document.body.innerHTML = buildSectionHTML([
      {
        class: 'modtype_kalvidres',
        inner: '<a href="https://keats.kcl.ac.uk/mod/kalvidres/view.php?id=5">Week 1 Video Kaltura Video Resource</a>',
      },
    ]);
    const results = bg.scrapeSectionPage(false);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('kaltura');
    expect(results[0].name).toBe('Week 1 Video');
  });

  test('skips resources with empty names', () => {
    document.body.innerHTML = buildSectionHTML([
      {
        class: 'modtype_resource',
        inner: '<a href="https://keats.kcl.ac.uk/mod/resource/view.php?id=6"> </a>',
      },
    ]);
    const results = bg.scrapeSectionPage(false);
    expect(results).toHaveLength(0);
  });

  test('resets optional flag on mandatory label', () => {
    document.body.innerHTML = buildSectionHTML([
      {
        class: 'modtype_label',
        inner: '<div>Optional Reading</div>',
      },
      {
        class: 'modtype_resource',
        inner: '<a href="https://keats.kcl.ac.uk/mod/resource/view.php?id=7">Optional File</a>',
      },
      {
        class: 'modtype_label',
        inner: '<div>Mandatory Core Materials</div>',
      },
      {
        class: 'modtype_resource',
        inner: '<a href="https://keats.kcl.ac.uk/mod/resource/view.php?id=8">Required Reading</a>',
      },
    ]);
    const results = bg.scrapeSectionPage(false);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Required Reading');
  });
});

describe('scrapeFolderPage', () => {
  test('extracts pluginfile links', () => {
    document.body.innerHTML = `
      <div id="region-main">
        <a href="https://keats.kcl.ac.uk/pluginfile.php/123/mod_folder/content/0/notes.pdf">notes.pdf</a>
        <a href="https://keats.kcl.ac.uk/pluginfile.php/123/mod_folder/content/0/slides.pptx">slides.pptx</a>
      </div>
    `;
    const results = bg.scrapeFolderPage();
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('notes.pdf');
    expect(results[0].type).toBe('folderFile');
    expect(results[1].name).toBe('slides.pptx');
  });

  test('prefers fp-filename-icon links', () => {
    document.body.innerHTML = `
      <div class="fp-filename-icon">
        <a href="https://keats.kcl.ac.uk/pluginfile.php/1/mod_folder/content/0/doc.pdf">doc.pdf</a>
      </div>
    `;
    const results = bg.scrapeFolderPage();
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('doc.pdf');
  });

  test('returns empty for pages with no files', () => {
    document.body.innerHTML = '<div id="region-main"><p>No files</p></div>';
    const results = bg.scrapeFolderPage();
    expect(results).toHaveLength(0);
  });

  test('decodes URL-encoded filenames', () => {
    document.body.innerHTML = `
      <div id="region-main">
        <a href="https://keats.kcl.ac.uk/pluginfile.php/1/mod_folder/content/0/my%20file%20(1).pdf">link</a>
      </div>
    `;
    const results = bg.scrapeFolderPage();
    expect(results[0].name).toBe('my file (1).pdf');
  });
});

describe('scrapeEcho360LTI', () => {
  test('finds lecture capture LTI links', () => {
    document.body.innerHTML = `
      <div class="activity modtype_lti" data-activityname="Lecture Capture Recordings">
        <a href="https://keats.kcl.ac.uk/mod/lti/view.php?id=100">Lecture Capture Recordings</a>
      </div>
    `;
    const results = bg.scrapeEcho360LTI();
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Lecture Capture Recordings');
  });

  test('falls back to all LTI links as candidates', () => {
    document.body.innerHTML = `
      <div class="activity modtype_lti" data-activityname="Some Tool">
        <a href="https://keats.kcl.ac.uk/mod/lti/view.php?id=200">Some Tool</a>
      </div>
    `;
    const results = bg.scrapeEcho360LTI();
    expect(results).toHaveLength(1);
    expect(results[0].isCandidate).toBe(true);
  });

  test('returns empty when no LTI activities', () => {
    document.body.innerHTML = '<div class="activity modtype_resource"></div>';
    const results = bg.scrapeEcho360LTI();
    expect(results).toHaveLength(0);
  });
});
