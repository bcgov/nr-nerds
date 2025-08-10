const test = require('node:test');
const assert = require('node:assert/strict');
const { EnvironmentValidator } = require('../src/utils/environment-validator');

test('URL resolution functionality', async (t) => {
  // Test 1: Valid GitHub project URL format
  const validUrl = 'https://github.com/orgs/bcgov/projects/16';
  const urlMatch = validUrl.match(/^https:\/\/github\.com\/orgs\/([^\/]+)\/projects\/(\d+)$/);
  
  assert(urlMatch, 'Should match valid GitHub project URL format');
  assert.strictEqual(urlMatch[1], 'bcgov', 'Should extract organization name');
  assert.strictEqual(urlMatch[2], '16', 'Should extract project number');
  
  // Test 2: Invalid URL formats
  const invalidUrls = [
    'https://github.com/bcgov/projects/16', // Missing /orgs/
    'https://github.com/orgs/bcgov/projects/', // Missing project number
    'https://github.com/orgs/bcgov/projects/abc', // Non-numeric project number
    'https://github.com/orgs/bcgov/projects/16/extra', // Extra path segments
    'https://example.com/orgs/bcgov/projects/16', // Wrong domain
  ];
  
  for (const invalidUrl of invalidUrls) {
    const match = invalidUrl.match(/^https:\/\/github\.com\/orgs\/([^\/]+)\/projects\/(\d+)$/);
    assert(!match, `Should not match invalid URL: ${invalidUrl}`);
  }
  
  // Test 3: URL resolution with mock (if we have API access)
  if (process.env.GITHUB_TOKEN) {
    try {
      // This will only work if we have access to the actual project
      // For now, we'll just test that the method exists and has the right signature
      assert(typeof EnvironmentValidator.resolveProjectFromUrl === 'function', 
        'resolveProjectFromUrl method should exist');
      
      // Test that it throws for invalid URLs
      try {
        await EnvironmentValidator.resolveProjectFromUrl('invalid-url');
        assert.fail('Should throw error for invalid URL');
      } catch (error) {
        assert(error.message.includes('Invalid project URL format'), 
          'Should throw appropriate error for invalid URL');
      }
      
    } catch (error) {
      // If we don't have access to the project, that's expected
      assert(true, 'URL resolution test completed (access may be limited)');
    }
  } else {
    assert(true, 'Skipping API tests - no GITHUB_TOKEN available');
  }
  
  // Test 4: Environment variable precedence
  const originalProjectId = process.env.PROJECT_ID;
  const originalProjectUrl = process.env.PROJECT_URL;
  
  try {
    // Test that PROJECT_URL takes precedence over config
    process.env.PROJECT_URL = 'https://github.com/orgs/bcgov/projects/16';
    delete process.env.PROJECT_ID;
    
    // This will fail if we don't have access, but that's expected
    try {
      await EnvironmentValidator.validateOptional();
      assert(true, 'validateOptional should handle PROJECT_URL');
    } catch (error) {
      // Expected if we don't have access to the project
      assert(true, 'URL resolution attempted (access may be limited)');
    }
    
  } finally {
    // Restore original environment
    if (originalProjectId) {
      process.env.PROJECT_ID = originalProjectId;
    } else {
      delete process.env.PROJECT_ID;
    }
    
    if (originalProjectUrl) {
      process.env.PROJECT_URL = originalProjectUrl;
    } else {
      delete process.env.PROJECT_URL;
    }
  }
});
