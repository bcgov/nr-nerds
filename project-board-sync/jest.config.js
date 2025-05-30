module.exports = {
  testEnvironment: 'node',
  verbose: true,
  testMatch: [
    "**/tests/**/*.js"
  ],
  setupFilesAfterEnv: ['./tests/jest.setup.js'],
  collectCoverageFrom: [
    "src/**/*.js",
    "!src/utils/log.js"
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  setupFilesAfterEnv: ['./tests/setup.js']
};
