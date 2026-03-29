<p align="center">
  <img src="extension/icons/icon128.png" alt="KEATS Downloader" width="80" />
</p>

<h1 align="center">KEATS Downloader</h1>

<p align="center">
  <strong>Download all your KEATS course materials in one click.</strong>
  <br />
  Lecture slides · PDFs · Videos · Podcasts — organised into folders automatically.
</p>

<p align="center">
  <sub>KEATS downloader · KCL KEATS download · King's College London lecture downloader · Moodle course downloader · download KEATS lectures · KEATS bulk download · KCL lecture slides download · KEATS video downloader · Moodle file downloader · university course material downloader</sub>
</p>

<p align="center">
  <a href="https://chrome.google.com/webstore"><img src="https://img.shields.io/badge/Chrome_Web_Store-coming_soon-c1002a?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome Web Store" /></a>
  <a href="../../releases"><img src="https://img.shields.io/badge/version-1.0.0-c1002a?style=for-the-badge" alt="Version" /></a>
  <a href="../../blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-c1002a?style=for-the-badge" alt="MIT License" /></a>
</p>

---

## Install

### Chrome Web Store

<!-- TODO: Replace with actual Chrome Web Store link when approved -->
[**Install KEATS Downloader**](https://chrome.google.com/webstore) — one click, no developer mode needed. *(Awaiting approval)*

### Manual Install

1. [Download this repo](../../archive/refs/heads/main.zip) and unzip
2. Open `chrome://extensions/`
3. Enable **Developer mode** → click **Load unpacked** → select the `extension/` folder

---

## How It Works

<table>
<tr>
<td width="50%">

1. Go to any KEATS course page
2. Click the extension icon
3. Pick what to download
4. Hit **Download All**

Everything saves to `Downloads/KEATS Downloads/` in organised folders.

</td>
<td width="50%">

**Download options:**
- ✅ Course materials (slides, PDFs, docs)
- ☐ Weekly videos (Kaltura)
- ☐ Lecture captures (Echo360, 720p)
- ✅ Folder contents
- ☐ Optional resources

</td>
</tr>
</table>

### Folder Structure

```
KEATS Downloads/
  Course Name/
    Week 1 - Topic/
      Lectures/
        lecture_slides.pdf
        podcast.m4a
        Session_1A.mp4
      Tutorials/
        worksheet.pdf
    Assessment/
      Coursework Brief/
        brief.pdf
    Lecture Recordings/
      Lecture - 20 Jan 2026.mp4
```

Subfolders are created from section headings on the course page — lectures, tutorials, assessments, and custom sections are all detected automatically.

---

## Features

| Feature | Details |
|---------|---------|
| **Bulk download** | Entire course in one click |
| **Smart folders** | Lectures, tutorials, assessments sorted automatically |
| **Kaltura videos** | Embedded lecture videos → MP4 |
| **Echo360 captures** | Recorded lectures → 720p MP4 |
| **Folder expansion** | Moodle folders unpacked and downloaded |
| **Optional filtering** | Skip supplementary materials |
| **Light / dark mode** | Toggle in the popup |
| **No install spam** | Download bar hidden during bulk downloads |
| **Zero dependencies** | Pure Chrome extension — nothing else needed |

---

## Supported Formats

Works across all KEATS course layouts:

| Layout | Status |
|--------|--------|
| Grid (image tiles) | ✅ |
| Topics (standard) | ✅ |
| Collapsed Topics | ✅ |
| One Topic (tabs) | ✅ |

### Downloadable Content

| Type | Status |
|------|--------|
| Files (PDF, PPTX, DOCX, ZIP, etc.) | ✅ |
| Media (M4A, MP3, MP4, WMV) | ✅ |
| Moodle folders | ✅ Expanded |
| Kaltura videos | ✅ Direct MP4 |
| Echo360 lecture captures | ✅ 720p MP4 |
| External URLs | Skipped |
| Quizzes, forums, assignments | Skipped |

---

## Other Universities

Works on **any Moodle-based LMS** — not just KEATS. Navigate to a course page and click the icon.

If your university's format isn't supported, [open an issue](../../issues).

---

## Contributing

Open source — pull requests welcome.

- **Bugs** → [open an issue](../../issues) with a screenshot and course URL
- **PRs** → fork, fix, submit
- **Features** → suggest via issues

---

## Background

Inspired by the original [keats_downloader](https://github.com/memst/keats_downloader) by [@memst](https://github.com/memst), a Python/Selenium script for Kaltura video downloads. This is a complete rewrite as a Chrome extension — no Python, no Selenium, no ffmpeg. Extends scope to all course materials, adds smart organisation, supports all Moodle formats, and includes Echo360 lecture capture downloads.

---

<p align="center">
  <sub>MIT License · Built for KCL students</sub>
</p>
