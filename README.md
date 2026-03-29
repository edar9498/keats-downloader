# KEATS Downloader

> Download all your KEATS course materials in one click.

A Chrome extension for [King's College London KEATS](https://keats.kcl.ac.uk) that bulk-downloads lecture slides, PDFs, podcasts, videos, and all course files — automatically organised into folders by week, with lectures and tutorials separated.

Also works with other Moodle-based university platforms.

## Install

### Chrome Web Store

<!-- TODO: Replace with actual Chrome Web Store link -->
[**Install KEATS Downloader**](https://chrome.google.com/webstore) (coming soon)

### Manual Install

1. [Download this repo](../../archive/refs/heads/main.zip) and unzip it
2. Go to `chrome://extensions/` in Chrome
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** and select the `extension/` folder
5. Pin the extension to your toolbar

## How It Works

1. Go to any KEATS course page
2. Click the KEATS Downloader icon
3. Choose what to download:
   - **Course materials** — slides, PDFs, documents, podcasts, code files
   - **Weekly videos** — Kaltura video resources embedded in sections
   - **Lecture captures** — Echo360 lecture recordings (720p MP4)
   - **Folder contents** — expands Moodle folders
   - **Optional resources** — supplementary/non-mandatory materials
4. Click **Download All**

Everything saves to `Downloads/KEATS Downloads/` with this structure:

```
KEATS Downloads/
  Course Name/
    Week 1 - Topic/
      Lectures/
        lecture_slides.pdf
        lecture_podcast.m4a
        Session_1A.mp4
      Tutorials/
        worksheet.pdf
    Week 2 - Topic/
      ...
    Assessment/
      Coursework Brief/
        brief.pdf
    Lecture Recordings/
      Lecture - 20 Jan 2026.mp4
      Lecture - 27 Jan 2026.mp4
```

Subfolders are created automatically based on section headings on the KEATS page.

## Features

- **One-click bulk download** of entire courses
- **Smart folder organisation** — lectures, tutorials, assessments sorted automatically
- **Kaltura video downloads** — embedded lecture videos downloaded as MP4
- **Echo360 lecture captures** — recorded lectures downloaded at 720p
- **Moodle folder expansion** — contents downloaded individually
- **Optional resource filtering** — skip supplementary materials
- **Light and dark mode**
- **No download spam** — Chrome's download bar hidden during bulk downloads
- **No dependencies** — pure Chrome extension, nothing else to install

## Supported Formats

Works across all KEATS course layouts:

| Format | Support |
|--------|---------|
| Grid (image tiles) | Full |
| Topics (standard) | Full |
| Collapsed Topics | Full |
| One Topic (tabs) | Full |

### Downloadable Content

| Type | Supported |
|------|-----------|
| Files (PDF, PPTX, DOCX, ZIP, etc.) | Yes |
| Media (M4A, MP3, MP4, WMV) | Yes |
| Moodle folders | Yes (expanded) |
| Kaltura videos | Yes (direct MP4) |
| Echo360 lecture captures | Yes (720p MP4) |
| External URLs | Skipped |
| Quizzes, forums, assignments | Skipped |

## Other Universities

This works on **any Moodle-based LMS** — not just KEATS. If your university uses Moodle, navigate to a course page and try it.

If your university's Moodle format isn't supported, [open an issue](../../issues).

## Contributing

Open source — pull requests welcome.

- **Bugs** — [open an issue](../../issues) with a screenshot and the course URL
- **Pull requests** — fork, fix, submit
- **Feature requests** — suggest via issues

## Background

Inspired by the original [keats_downloader](https://github.com/memst/keats_downloader) by [@memst](https://github.com/memst), which was a Python/Selenium script for downloading Kaltura videos from KEATS. This project is a complete rewrite as a Chrome extension — no Python, no Selenium, no ffmpeg. It extends the scope beyond videos to all course materials, adds smart folder organisation, supports all Moodle course formats, and includes Echo360 lecture capture downloads.

## License

MIT
