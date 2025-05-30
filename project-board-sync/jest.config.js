module.exports = {
  testEnvironment: 'node',
  verbose: true,
  // Only match files that start with "test-" in the tests directory
  testMatch: [
    "**/tests/test-*.js"
  ],
  // Setup files are now in test-config
  setupFilesAfterEnv: [
    './test-config/setup.js',
    './test-config/jest.setup.js'
  ],
  // Mock implementations are in test-config/mocks
  moduleDirectories: ['node_modules', 'test-config'],
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
  }
};
