const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateEnvironment } = require('../../src/index.js');

test('environment validation', async (t) => {
  const originalEnv = { ...process.env };

  t.afterEach(() => {
    process.env = { ...originalEnv };
  });

  await t.test('accepts valid environment with required variables', () => {
    process.env.GH_TOKEN = 'test-token';
    process.env.PROJECT_ID = 'test-project';
    assert.doesNotThrow(() => validateEnvironment());
  });

  await t.test('accepts valid environment with default project ID', () => {
    process.env.GH_TOKEN = 'test-token';
    delete process.env.PROJECT_ID;
    assert.doesNotThrow(() => validateEnvironment());
  });

  await t.test('rejects missing GH_TOKEN', () => {
    delete process.env.GH_TOKEN;
    process.env.PROJECT_ID = 'test-project';
    assert.throws(() => validateEnvironment(), /GH_TOKEN.*required/);
  });

  await t.test('loads configuration when valid', () => {
    process.env.GH_TOKEN = 'test-token';
    process.env.PROJECT_ID = 'test-project';
    validateEnvironment();
    assert(require('../../src/utils/state-verifier').StateVerifier.steps.areAllStepsCompleted());
  });

  await t.test('validates config dependencies in correct order', () => {
    process.env.GH_TOKEN = 'test-token';
    delete process.env.PROJECT_ID;
    validateEnvironment();
    const steps = require('../../src/utils/state-verifier').StateVerifier.steps;
    assert(steps.getCompletedSteps().indexOf('TOKEN_CONFIGURED') < steps.getCompletedSteps().indexOf('PROJECT_CONFIGURED'));
  });
});
