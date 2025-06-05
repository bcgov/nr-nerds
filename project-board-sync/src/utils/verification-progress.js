/**
 * @fileoverview Tracks progress and performance of verification operations
 * @see /src/index.js for project conventions and architecture
 * 
 * Module Conventions:
 * - Progress tracking includes step-by-step verification
 * - API performance metrics are collected per endpoint
 * - Operation progress is tracked with success/failure
 * - Detailed timing statistics are maintained
 * 
 * Documentation Update Guidelines:
 * Update this documentation when:
 * - Adding new progress tracking metrics
 * - Modifying API timing collection
 * - Changing progress reporting format
 * - Adding new operation types
 * 
 * Maintain Stability:
 * - Keep API timing format consistent
 * - Preserve progress step tracking
 * - Document new progress metrics
 * - Test progress tracking flows
 */

/**
 * Tracks progress and performance of verification operations
 */
class VerificationProgress {
  constructor() {
    this.apiTimings = new Map();
    this.operationProgress = new Map();
    this.startTime = Date.now();
  }

  /**
   * Start tracking a verification operation
   */
  startOperation(type, itemRef, totalSteps) {
    const key = `${type}-${itemRef}`;
    this.operationProgress.set(key, {
      type,
      itemRef,
      currentStep: 0,
      totalSteps,
      steps: [],
      startTime: Date.now()
    });
  }

  /**
   * Record progress of a verification step
   */
  recordStep(type, itemRef, stepDescription, success = true) {
    const key = `${type}-${itemRef}`;
    const operation = this.operationProgress.get(key);
    if (!operation) return;

    operation.currentStep++;
    operation.steps.push({
      description: stepDescription,
      success,
      timing: Date.now() - operation.startTime
    });
  }

  /**
   * Record API call timing
   */
  recordApiTiming(endpoint, duration) {
    if (!this.apiTimings.has(endpoint)) {
      this.apiTimings.set(endpoint, {
        calls: 0,
        totalDuration: 0,
        maxDuration: 0,
        minDuration: Infinity
      });
    }

    const stats = this.apiTimings.get(endpoint);
    stats.calls++;
    stats.totalDuration += duration;
    stats.maxDuration = Math.max(stats.maxDuration, duration);
    stats.minDuration = Math.min(stats.minDuration, duration);
  }

  /**
   * Print verification progress report
   */
  printProgressReport() {
    console.log('\n📈 Verification Progress Report');
    console.log('════════════════════════════\n');

    // Print operation progress
    for (const [key, operation] of this.operationProgress) {
      const progress = (operation.currentStep / operation.totalSteps * 100).toFixed(0);
      const duration = ((Date.now() - operation.startTime) / 1000).toFixed(1);
      
      console.log(`${operation.type}: ${operation.itemRef}`);
      console.log(`Progress: ${progress}% (${operation.currentStep}/${operation.totalSteps})`);
      console.log(`Duration: ${duration}s\n`);

      operation.steps.forEach((step, index) => {
        const timing = (step.timing / 1000).toFixed(1);
        const icon = step.success ? '✓' : '❌';
        console.log(`  ${icon} Step ${index + 1}: ${step.description} (${timing}s)`);
      });
      console.log();
    }

    // Print API performance metrics
    console.log('🔍 API Performance Metrics');
    console.log('═════════════════════════\n');

    for (const [endpoint, stats] of this.apiTimings) {
      const avgDuration = stats.totalDuration / stats.calls;
      console.log(`${endpoint}:`);
      console.log(`  Calls: ${stats.calls}`);
      console.log(`  Avg Duration: ${(avgDuration / 1000).toFixed(1)}s`);
      console.log(`  Max Duration: ${(stats.maxDuration / 1000).toFixed(1)}s`);
      console.log(`  Min Duration: ${(stats.minDuration / 1000).toFixed(1)}s\n`);
    }

    // Print total execution time
    const totalDuration = ((Date.now() - this.startTime) / 1000).toFixed(1);
    console.log(`Total Verification Time: ${totalDuration}s`);
  }
}

module.exports = {
  VerificationProgress
};
