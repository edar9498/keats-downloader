module.exports = {
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  projects: [
    {
      displayName: 'node',
      testMatch: ['<rootDir>/tests/background.test.js'],
      testEnvironment: 'node',
    },
    {
      displayName: 'jsdom',
      testMatch: ['<rootDir>/tests/scraping.test.js', '<rootDir>/tests/popup.test.js'],
      testEnvironment: 'jsdom',
    },
  ],
};
