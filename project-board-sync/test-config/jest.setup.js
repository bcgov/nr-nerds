// Jest setup file
process.env.NODE_ENV = 'test';
process.env.GH_TOKEN = process.env.GH_TOKEN || 'test-token';
process.env.GITHUB_AUTHOR = process.env.GITHUB_AUTHOR || 'test-user';

// Silence console output during tests unless explicitly wanted
global.console = {
  ...console,
  log: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
};
