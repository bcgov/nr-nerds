#!/usr/bin/env node

/**
 * @fileoverview Consolidated validation script
 * Integrates all validation, testing and config checks into one command
 */

const { ValidationRunner } = require('../src/utils/validation-runner');

async function main() {
  console.log('Running project validations...\n');
  
  const result = await ValidationRunner.runValidations({
    validateState: true
  });

  if (result.success) {
    console.log('\nValidation Summary:');
    if (result.results.environment) console.log('✓ Environment validation passed');
    if (result.results.config) console.log('✓ Configuration validation passed');
    if (result.results.state) console.log('✓ State tracking validation passed');
    
    // Print detailed reports
    ValidationRunner.printReports();
    
    console.log('\n✅ All validations passed! Safe to deploy.');
    process.exit(0);
  } else {
    console.error('\n❌ Validation failed:', result.error);
    
    // Print validation state
    console.error('\nValidation State:');
    if (!result.results.environment) console.error('✗ Environment validation failed');
    if (!result.results.config) console.error('✗ Configuration validation failed');  
    if (!result.results.state) console.error('✗ State tracking validation failed');
    
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
