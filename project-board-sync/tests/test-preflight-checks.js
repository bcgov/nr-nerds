//
// Test script for validating preflight checks
// Usage: node tests/test-preflight-checks.js

// This script imports the necessary modules and runs just the preflight checks
// from the main project-sync.js file.

const path = require('path');

// Set up error handlers for uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Display test header
console.log('----------------------------------------------');
console.log('  NERDS Project Sync Preflight Tests');
console.log('----------------------------------------------');
console.log(`Testing environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`Time: ${new Date().toISOString()}`);
console.log(`GH_TOKEN available: ${process.env.GH_TOKEN ? 'Yes' : 'No'}`);

// Import the main script
try {
  console.log('\nImporting project-sync modules...');
  const { runPreflightChecks } = require('../project-board-sync.js');
  
  if (!runPreflightChecks) {
    console.error('ERROR: runPreflightChecks function not found in project-board-sync.js');
    process.exit(1);
  }
  
  console.log('Successfully imported modules, running preflight checks...\n');
  
  // Run just the preflight checks
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
      process.exit(1);
    });
} catch (error) {
  console.error('FATAL ERROR loading project-sync.js:', error);
  process.exit(1);
}
