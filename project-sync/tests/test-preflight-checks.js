//
// Test script for validating preflight checks
// Usage: node tests/test-preflight-checks.js

// This script imports the necessary modules and runs just the preflight checks
// from the main project-sync.js file.

const path = require('path');

// Display test header
console.log('----------------------------------------------');
console.log('  NERDS Project Sync Preflight Tests');
console.log('----------------------------------------------');
console.log(`Testing environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`Time: ${new Date().toISOString()}`);
console.log(`GH_TOKEN available: ${process.env.GH_TOKEN ? 'Yes' : 'No'}`);
console.log(`GITHUB_AUTHOR: ${process.env.GITHUB_AUTHOR || 'Not set'}`);

// Import the main script
try {
  console.log('\nImporting project-sync modules...');
  const { runPreflightChecks } = require('../project-sync.js');
  
  if (!runPreflightChecks) {
    console.error('ERROR: runPreflightChecks function not found in project-sync.js');
    process.exit(1);
  }
  
  console.log('Successfully imported modules, running preflight checks...\n');
  
  // Run just the preflight checks
  // Check if the GH_TOKEN env variable is set
  console.log('Checking environment:');
  console.log(`- GH_TOKEN: ${process.env.GH_TOKEN ? 'Set ✓' : 'Not Set ✗'}`);
  console.log(`- NODE_ENV: ${process.env.NODE_ENV || 'Not Set'}`);
  console.log(`- GITHUB_AUTHOR: ${process.env.GITHUB_AUTHOR || 'Not Set'}`);
  
  runPreflightChecks()
    .then(passed => {
      console.log('\n----------------------------------------------');
      if (passed) {
        console.log('✅ All preflight checks completed successfully!');
        console.log('The project-sync automation is properly configured.');
      } else {
        console.log('❌ Some preflight checks failed!');
        console.log('Please address the issues above before running the main script.');
      }
      console.log('----------------------------------------------');
      
      // Exit with appropriate code
      process.exit(passed ? 0 : 1);
    })
    .catch(error => {
      console.error('FATAL ERROR during preflight checks:', error);
      console.error('Error stack:', error.stack);
      process.exit(1);
    });
} catch (error) {
  console.error('FATAL ERROR loading project-sync.js:', error);
  process.exit(1);
}
