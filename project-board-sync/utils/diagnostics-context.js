
/**
 * Helper class for managing diagnostics and rate limit information
 */
class DiagnosticsContext {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.infos = [];
    this.verboseData = []; // For storing detailed JSON records
    this.rateLimitStats = null; // For storing rate limit information
  }

  /**
   * Add a detailed verbose record for troubleshooting
   * @param {Object} data - Structured data about the operation
   */
  addVerboseRecord(data) {
    // Ensure timestamp is added to each record
    this.verboseData.push({
      timestamp: new Date().toISOString(),
      ...data,
      rateLimits: this.rateLimitStats
    });
  }

  /**
   * Update rate limit statistics
   */
  async updateRateLimitStats(rateLimitManager) {
    try {
      this.rateLimitStats = await rateLimitManager.getRateLimits();
      // Log warning if remaining rate limit is low
      if (this.rateLimitStats.remaining < 100) {
        this.warnings.push(`Rate limit running low: ${this.rateLimitStats.remaining}/${this.rateLimitStats.limit} remaining, resets at ${new Date(this.rateLimitStats.reset * 1000).toISOString()}`);
      }
    } catch (error) {
      this.warnings.push(`Failed to update rate limit stats: ${error.message}`);
    }
  }
}

module.exports = DiagnosticsContext;
