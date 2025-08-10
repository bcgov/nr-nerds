const test = require('node:test');
const assert = require('node:assert/strict');
const { EnvironmentValidator } = require('../src/utils/environment-validator');

test('Environment validation works correctly', async (t) => {
  // Test 1: Missing required variables
  const originalToken = process.env.GITHUB_TOKEN;
  const originalAuthor = process.env.GITHUB_AUTHOR;
  
  // Remove required variables
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_AUTHOR;
  
  try {
    await EnvironmentValidator.validateAll();
    assert.fail('Should have thrown an error for missing variables');
  } catch (error) {
    assert(error.message.includes('Missing required environment variables'));
    assert(error.message.includes('GITHUB_TOKEN'));
    assert(error.message.includes('GITHUB_AUTHOR'));
    assert(true, 'Correctly caught missing environment variables');
  }
  
  // Restore variables
  process.env.GITHUB_TOKEN = originalToken;
  process.env.GITHUB_AUTHOR = originalAuthor;
  
  // Test 2: Valid environment (if we have the variables set)
  if (originalToken && originalAuthor) {
    try {
      const config = await EnvironmentValidator.validateAll();
      assert(config.githubUser, 'Should return GitHub user');
      assert(config.projectId, 'Should return project ID');
      assert(typeof config.verbose === 'boolean', 'Should return verbose flag');
      assert(true, 'Environment validation passed with valid variables');
    } catch (error) {
      assert.fail(`Environment validation failed (this is expected if token is invalid): ${error.message}`);
    }
  } else {
    assert(true, 'Skipping valid environment test - variables not set');
  }
  
  // Test 3: Required variables validation
  try {
    EnvironmentValidator.validateRequired();
    assert(true, 'Required variables validation passed');
  } catch (error) {
    assert.fail(`Required variables validation failed: ${error.message}`);
  }
  
  // Test 4: Optional variables validation
  try {
    const config = await EnvironmentValidator.validateOptional();
    assert(config.projectId, 'Should return project ID');
    assert(typeof config.verbose === 'boolean', 'Should return verbose flag');
    assert(typeof config.strictMode === 'boolean', 'Should return strict mode flag');
    assert(true, 'Optional variables validation passed');
  } catch (error) {
    assert.fail(`Optional variables validation failed: ${error.message}`);
  }
}); 
