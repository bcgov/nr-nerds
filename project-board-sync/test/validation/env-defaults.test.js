const test = require('node:test');
const assert = require('node:assert/strict');
const { EnvironmentValidator } = require('../../src/utils/environment-validator');
const { loadBoardRules } = require('../../src/config/board-rules');

// Store original env
const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
}

test('environment validation with defaults', async (t) => {
  // Reset env before each test
  t.beforeEach(resetEnv);
  t.afterEach(resetEnv);

  const config = await loadBoardRules();

  await t.test('works with default project ID', async () => {
    // Only set required variables
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.GITHUB_AUTHOR = config.monitoredUser;
    delete process.env.PROJECT_ID;

    // Should not throw with default project ID
    try {
      await EnvironmentValidator.validateAll();
      assert(true, 'Should not throw with default project ID');
    } catch (error) {
      // Expected to fail due to invalid token, but should not fail due to missing PROJECT_ID
      assert(!error.message.includes('PROJECT_ID'), 'Should not fail due to missing PROJECT_ID');
    }
  });

  await t.test('works with custom project ID', async () => {
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.GITHUB_AUTHOR = config.monitoredUser;
    process.env.PROJECT_ID = 'custom-id';

    try {
      await EnvironmentValidator.validateAll();
      assert(true, 'Should not throw with custom project ID');
    } catch (error) {
      // Expected to fail due to invalid token, but should not fail due to PROJECT_ID
      assert(!error.message.includes('PROJECT_ID'), 'Should not fail due to PROJECT_ID');
    }
  });

  await t.test('fails without GITHUB_TOKEN', async () => {
    delete process.env.GITHUB_TOKEN;
    process.env.GITHUB_AUTHOR = config.monitoredUser;

    try {
      await EnvironmentValidator.validateAll();
      assert.fail('Should have thrown an error for missing GITHUB_TOKEN');
    } catch (error) {
      assert(error.message.includes('Missing required environment variables'), 'Should mention missing variables');
      assert(error.message.includes('GITHUB_TOKEN'), 'Should mention GITHUB_TOKEN');
    }
  });

  await t.test('preserves backwards compatibility', async () => {
    // Test that old environment setups still work
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.GITHUB_AUTHOR = config.monitoredUser;
    process.env.PROJECT_ID = config.projectId;

    try {
      await EnvironmentValidator.validateAll();
      assert(true, 'Should not throw with old environment setup');
    } catch (error) {
      // Expected to fail due to invalid token, but should not fail due to setup
      assert(!error.message.includes('Missing required environment variables'), 'Should not fail due to missing variables');
    }
  });
});
