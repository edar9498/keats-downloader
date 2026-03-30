// Shared Chrome API mock for tests
function createChromeMock() {
  const downloadListeners = [];
  let nextDownloadId = 1;

  return {
    runtime: {
      lastError: null,
      onMessage: { addListener: jest.fn() },
      sendMessage: jest.fn().mockResolvedValue(undefined),
    },
    tabs: {
      create: jest.fn().mockResolvedValue({ id: 99 }),
      remove: jest.fn().mockResolvedValue(),
      update: jest.fn((id, opts, cb) => cb && cb()),
      get: jest.fn().mockResolvedValue({ url: 'about:blank' }),
      query: jest.fn().mockResolvedValue([]),
      onUpdated: {
        addListener: jest.fn(),
        removeListener: jest.fn(),
      },
    },
    downloads: {
      download: jest.fn((opts, cb) => {
        const id = nextDownloadId++;
        cb(id);
        // Auto-complete the download after a tick
        setTimeout(() => {
          for (const listener of downloadListeners) {
            listener({ id, state: { current: 'complete' } });
          }
        }, 10);
      }),
      setUiOptions: jest.fn().mockResolvedValue(),
      onChanged: {
        addListener: jest.fn((fn) => downloadListeners.push(fn)),
        removeListener: jest.fn((fn) => {
          const idx = downloadListeners.indexOf(fn);
          if (idx >= 0) downloadListeners.splice(idx, 1);
        }),
      },
    },
    scripting: {
      executeScript: jest.fn().mockResolvedValue([{ result: [] }]),
    },
  };
}

module.exports = { createChromeMock };
