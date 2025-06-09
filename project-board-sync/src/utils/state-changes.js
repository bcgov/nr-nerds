/**
 * @fileoverview Tracks state changes during item synchronization
 * @see /src/index.js for project conventions and architecture
 * 
 * Module Conventions:
 * - Each item's state history is preserved for the duration of sync
 * - Timing statistics are tracked for performance monitoring
 * - All state changes are recorded with before/after values
 * - Error tracking includes attempt counts and timestamps
 * 
 * Documentation Update Guidelines:
 * Update this documentation when:
 * - Adding new types of state tracking
 * - Modifying timing statistics collection
 * - Changing error tracking behavior
 * - Adding new summary report formats
 * 
 * Maintain Stability:
 * - Preserve state history format for reporting
 * - Keep timing statistics consistent
 * - Document any new state tracking fields
 * - Test state change tracking flows
 */

/**
 * Tracks state changes during item synchronization
 */
class StateChangeTracker {
  constructor() {
    this.changes = new Map();
    this.startTimes = new Map();
    this.errors = new Map();
    this.currentState = new Map(); // Track current state for each item
    this.timingStats = {
      totalDuration: 0,
      verificationCounts: {},
      averageDurations: {},
      maxRetries: {},
    };
  }

  /**
   * Start tracking changes for an item
   */
  startTracking(item) {
    const key = `${item.type}#${item.number}`;
    this.startTimes.set(key, Date.now());
    this.changes.set(key, []);
    
    // Initialize with meaningful initial state
    const initialState = {
      inProject: item.projectItems?.nodes?.length > 0,
      projectItemId: item.projectItems?.nodes?.[0]?.id || null
    };
    this.currentState.set(key, initialState);
  }

  /**
   * Record a state change
   */
  recordChange(item, type, before, after, attemptCount = 1) {
    const key = `${item.type}#${item.number}`;
    const changes = this.changes.get(key) || [];
    
    // Get the last known state
    const lastChange = changes[changes.length - 1];
    const currentState = lastChange ? lastChange.after : {};
    
    // Create new state by merging current with after
    const newState = {
      ...currentState,
      ...after
    };
    
    changes.push({
      type,
      timestamp: new Date(),
      before: attemptCount === 1 ? before : currentState,
      after: newState,
      attemptCount,
      duration: Date.now() - this.startTimes.get(key)
    });

    this.changes.set(key, changes);
    
    // Update timing stats
    this.updateTimingStats(type, changes[changes.length - 1].duration, attemptCount);
  }

  /**
   * Track verification error
   */
  recordError(item, type, error, attempt) {
    const key = `${item.type}#${item.number}`;
    if (!this.errors.has(key)) {
      this.errors.set(key, []);
    }
    this.errors.get(key).push({
      type,
      error: error.message,
      attempt,
      timestamp: new Date()
    });
  }

  /**
   * Update timing statistics
   */
  updateTimingStats(type, duration, attempts) {
    if (!this.timingStats.verificationCounts[type]) {
      this.timingStats.verificationCounts[type] = 0;
      this.timingStats.averageDurations[type] = 0;
      this.timingStats.maxRetries[type] = 0;
    }

    // Update counts and averages
    const count = ++this.timingStats.verificationCounts[type];
    const oldAvg = this.timingStats.averageDurations[type];
    this.timingStats.averageDurations[type] = oldAvg + (duration - oldAvg) / count;
    this.timingStats.totalDuration += duration;

    // Track max retries
    if (attempts > this.timingStats.maxRetries[type]) {
      this.timingStats.maxRetries[type] = attempts;
    }
  }

  /**
   * Print a summary of state changes with enhanced statistics
   */
  printSummary() {
    console.log('\n📊 State Change Summary');
    console.log('═══════════════════════\n');

    // Print changes per item
    for (const [itemKey, changes] of this.changes.entries()) {
      if (changes.length === 0) continue;

      console.log(`🔄 ${itemKey}`);
      for (const change of changes) {
        const duration = (change.duration / 1000).toFixed(1);
        console.log(`  • ${change.type} (${duration}s, ${change.attemptCount} attempts)`);
        
        // Print state differences in a readable format
        if (typeof change.before === 'object') {
          const diffs = this.getDiffs(change.before, change.after);
          diffs.forEach(diff => console.log(`    ${diff}`));
        } else {
          console.log(`    ${change.before} → ${change.after}`);
        }
      }
      console.log();
    }

    // Print timing statistics
    console.log('⏱️  Timing Statistics');
    console.log('══════════════════\n');
    console.log(`Total Duration: ${(this.timingStats.totalDuration / 1000).toFixed(1)}s\n`);
    
    Object.keys(this.timingStats.verificationCounts).forEach(type => {
      const count = this.timingStats.verificationCounts[type];
      const avgDuration = this.timingStats.averageDurations[type];
      const maxRetries = this.timingStats.maxRetries[type];
      
      console.log(`${type}:`);
      console.log(`  Count: ${count}`);
      console.log(`  Avg Duration: ${(avgDuration / 1000).toFixed(1)}s`);
      console.log(`  Max Retries: ${maxRetries}`);
    });
  }

  /**
   * Get differences between two states
   */
  getDiffs(before, after) {
    const diffs = [];
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    let projectIdShown = false;

    for (const key of allKeys) {
      const beforeVal = before[key];
      const afterVal = after[key];

      // Skip if values are deeply equal
      if (JSON.stringify(beforeVal) === JSON.stringify(afterVal)) {
        continue;
      }

      // Special handling for project board states
      if (key === 'inProject' && afterVal === true) {
        diffs.push('✓ Added to project board');
        continue;
      }

      if (key === 'projectItemId' && afterVal && !projectIdShown) {
        diffs.push(`Project Item ID: ${afterVal}`);
        projectIdShown = true;
        continue;
      }

      // Format values for display
      const formatValue = (val) => {
        if (val === undefined || val === null) return 'Not Set';
        if (val === '') return 'Empty';
        if (Array.isArray(val)) return val.length ? val.join(', ') : '[]';
        return val.toString();
      };

      const beforeStr = formatValue(beforeVal);
      const afterStr = formatValue(afterVal);

      // Only show meaningful changes
      if (beforeStr !== afterStr) {
        const changeIcon = afterStr === 'Not Set' ? '❌' : '✓';
        diffs.push(`${changeIcon} ${key}: ${beforeStr} → ${afterStr}`);
      }
    }

    return diffs;
  }
}

module.exports = {
  StateChangeTracker
};
