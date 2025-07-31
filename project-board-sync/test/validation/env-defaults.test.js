const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEnvironment } = require('../../src/index');

// Store original env
const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
}

test('environment validation with defaults', async (t) => {
  // Reset env before each test
  t.beforeEach(resetEnv);
  t.afterEach(resetEnv);

  await t.test('works with default project ID', async () => {
    // Only set required GITHUB_TOKEN
    process.env.GITHUB_TOKEN = 'test-token';
    delete process.env.PROJECT_ID;

    // Should not throw with default project ID
    assert.doesNotThrow(() => validateEnvironment());
  });

  await t.test('works with custom project ID', async () => {
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.PROJECT_ID = 'custom-id';

    assert.doesNotThrow(() => validateEnvironment());
  });

  await t.test('fails without GITHUB_TOKEN', async () => {
    delete process.env.GITHUB_TOKEN;

    assert.throws(() => validateEnvironment(), {
      message: 'GITHUB_TOKEN environment variable is required'
    });
  });

  await t.test('preserves backwards compatibility', async () => {
    // Test that old environment setups still work
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.PROJECT_ID = 'PVT_kwDOAA37OM4AFuzg';

    assert.doesNotThrow(() => validateEnvironment());
  });
});
