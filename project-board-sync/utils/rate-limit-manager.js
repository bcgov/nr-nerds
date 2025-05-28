
/**
 * Manages GitHub API rate limiting with retry logic and backoff
 */
class RateLimitManager {
  constructor(octokit, options = {}) {
    this.octokit = octokit;
    this.options = {
      maxRetries: options.maxRetries || 3,
      initialRetryDelay: options.initialRetryDelay || 1000,
      maxRetryDelay: options.maxRetryDelay || 10000,
      ...options
    };
    this.etags = new Map();
  }

  /**
   * Execute an API call with automatic retry and backoff
   */
  async executeWithRetry(operation, context = {}) {
    let lastError;
    let delay = this.options.initialRetryDelay;

    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      try {
        // Check rate limits before making the call
        await this.waitForRateLimit();

        // Add If-None-Match header if we have an ETag
        const requestOptions = { ...context };
        const cacheKey = this.getCacheKey(operation, context);
        if (this.etags.has(cacheKey)) {
          requestOptions.headers = {
            ...requestOptions.headers,
            'If-None-Match': this.etags.get(cacheKey)
          };
        }

        // Make the API call
        const response = await operation(requestOptions);

        // Store ETag if present
        const etag = response.headers?.etag;
        if (etag) {
          this.etags.set(cacheKey, etag);
        }

        return response;
      } catch (error) {
        lastError = error;

        // Don't retry on authentication errors or not found
        if (error.status === 401 || error.status === 404) {
          throw error;
        }

        // Check if we should retry
        if (this.shouldRetry(error, attempt)) {
          console.warn(`API call failed (attempt ${attempt}/${this.options.maxRetries}), retrying in ${delay}ms:`, error.message);
          await this.sleep(delay);
          delay = Math.min(delay * 2, this.options.maxRetryDelay);
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  /**
   * Wait if we're approaching rate limits
   */
  async waitForRateLimit() {
    const limits = await this.getRateLimits();
    
    // If we're close to hitting the rate limit, wait until reset
    if (limits.remaining < 100) {
      const waitTime = (limits.reset * 1000) - Date.now() + 1000; // Add 1s buffer
      if (waitTime > 0) {
        console.warn(`Rate limit low (${limits.remaining}/${limits.limit}), waiting ${Math.round(waitTime/1000)}s until reset`);
        await this.sleep(waitTime);
      }
    }
  }

  /**
   * Get current rate limit status
   */
  async getRateLimits() {
    try {
      const { data } = await this.octokit.rateLimit.get();
      return {
        limit: data.resources.core.limit,
        remaining: data.resources.core.remaining,
        reset: data.resources.core.reset,
        graphql: {
          limit: data.resources.graphql.limit,
          remaining: data.resources.graphql.remaining,
          reset: data.resources.graphql.reset
        }
      };
    } catch (error) {
      console.error('Failed to fetch rate limits:', error);
      return {
        limit: 5000,
        remaining: 4000,
        reset: Math.floor(Date.now() / 1000) + 3600
      };
    }
  }

  /**
   * Determine if an error should trigger a retry
   */
  shouldRetry(error, attempt) {
    // Retry on rate limits or server errors
    return (
      attempt < this.options.maxRetries && 
      (error.status === 403 || error.status === 429 || error.status >= 500)
    );
  }

  /**
   * Generate a cache key for ETag storage
   */
  getCacheKey(operation, context) {
    return JSON.stringify({
      op: operation.name || 'anonymous',
      context: context
    });
  }

  /**
   * Sleep for specified milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = RateLimitManager;
