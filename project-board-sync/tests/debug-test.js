// A simple debug test script
console.log('Debug test starting...');

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

console.log('Environment variables:');
console.log('GH_TOKEN available:', !!process.env.GH_TOKEN);
console.log('NODE_ENV:', process.env.NODE_ENV);

try {
  const { runPreflightChecks } = require('../project-sync.js');
  console.log('Successfully required project-sync.js');
  console.log('runPreflightChecks available:', !!runPreflightChecks);
} catch (error) {
  console.error('Error requiring project-sync.js:', error);
}

console.log('Debug test complete.');
