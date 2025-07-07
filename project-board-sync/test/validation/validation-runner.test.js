/**
 * @fileoverview Tests for validation runner
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { ValidationRunner } = require('../../src/utils/validation-runner');

test('ValidationRunner', async (t) => {
  const originalEnv = { ...process.env };

  t.beforeEach(() => {
    process.env = {
      ...originalEnv,
      GITHUB_TOKEN: 'test-token'
    };
  });

  t.afterEach(() => {
    process.env = { ...originalEnv };
  });

  await t.test('validates environment and configuration', async () => {
    const result = await ValidationRunner.runValidations();
    assert.equal(result.success, true, 'Validation should pass with valid environment');
    assert.equal(result.results.environment, true, 'Environment validation should pass');
    assert.equal(result.results.config, true, 'Configuration validation should pass');
  });

  await t.test('validates state tracking when enabled', async () => {
    const result = await ValidationRunner.runValidations({ validateState: true });
    assert.equal(result.success, true, 'Validation should pass');
    assert.equal(result.results.state, true, 'State validation should pass when enabled');
  });

  await t.test('handles environment validation failure', async () => {
    delete process.env.GITHUB_TOKEN;
    const result = await ValidationRunner.runValidations();
    assert.equal(result.success, false, 'Should fail with missing GITHUB_TOKEN');
    assert.equal(result.results.environment, false, 'Should indicate environment validation failed');
    assert.ok(result.error.includes('GITHUB_TOKEN'), 'Should include error about missing token');
  });

  await t.test('validates project ID consistency', async () => {
    process.env.PROJECT_ID = 'custom-id';
    const result = await ValidationRunner.runValidations();
    assert.equal(result.success, true, 'Should pass with custom project ID');
  });
});
