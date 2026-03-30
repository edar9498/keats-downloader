// Tests for popup.js utility functions

describe('isMoodleCoursePage', () => {
  // Inline the function since popup.js has side effects we can't easily load
  function isMoodleCoursePage(url) {
    if (!url) return false;
    return /\/course\/view\.php/.test(url);
  }

  test('matches standard Moodle course URL', () => {
    expect(isMoodleCoursePage('https://keats.kcl.ac.uk/course/view.php?id=12345')).toBe(true);
  });

  test('matches other Moodle instances', () => {
    expect(isMoodleCoursePage('https://moodle.example.com/course/view.php?id=1')).toBe(true);
  });

  test('rejects non-course Moodle pages', () => {
    expect(isMoodleCoursePage('https://keats.kcl.ac.uk/my/')).toBe(false);
    expect(isMoodleCoursePage('https://keats.kcl.ac.uk/mod/resource/view.php?id=1')).toBe(false);
  });

  test('rejects null/undefined/empty', () => {
    expect(isMoodleCoursePage(null)).toBe(false);
    expect(isMoodleCoursePage(undefined)).toBe(false);
    expect(isMoodleCoursePage('')).toBe(false);
  });

  test('rejects non-Moodle URLs', () => {
    expect(isMoodleCoursePage('https://google.com')).toBe(false);
    expect(isMoodleCoursePage('https://example.com/course/')).toBe(false);
  });
});

describe('esc (HTML escaping)', () => {
  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  test('escapes angle brackets', () => {
    expect(esc('<script>alert("xss")</script>')).not.toContain('<script>');
  });

  test('escapes ampersands', () => {
    expect(esc('a & b')).toBe('a &amp; b');
  });

  test('preserves normal text', () => {
    expect(esc('Hello World')).toBe('Hello World');
  });
});
