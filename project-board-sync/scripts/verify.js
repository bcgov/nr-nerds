#!/usr/bin/env node

/**
 * Verify Script
 * 
 * Runs all validations and tests before pushing to ensure code quality.
 * Run this script before pushing changes to catch common issues.
 */

const { spawnSync } = require('child_process');
const path = require('path');

// Config
const TESTS = [
  'test/validation/env-defaults.test.js',
  'test/validation/environment.test.js',
  'test/state-transition-validator.test.js',
  'test/state-verifier.test.js',
  'test/rules/workflow.test.js'
];

function runCommand(cmd, args, options = {}) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    ...options
  });
  
  if (result.status !== 0) {
    console.error(`Command failed with exit code ${result.status}`);
    process.exit(1);
  }
}

async function main() {
  try {
    // Run tests with default environment
    console.log('\n📋 Running tests with default environment...');
    const testEnv = {
      ...process.env,
      GH_TOKEN: 'test-token',
      NODE_ENV: 'test'
    };

    for (const test of TESTS) {
      runCommand('node', [test], { env: testEnv });
    }

    // Run tests with custom project ID
    console.log('\n📋 Running tests with custom project ID...');
    const customEnv = {
      ...testEnv,
      PROJECT_ID: 'custom-test-id'
    };

    for (const test of TESTS) {
      runCommand('node', [test], { env: customEnv });
    }

    console.log('\n✅ All validations passed! Safe to push changes.');

  } catch (error) {
    console.error('\n❌ Validation failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
