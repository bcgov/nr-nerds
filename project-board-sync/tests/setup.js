// Test configuration
const TEST_CONFIG = {
  projectId: process.env.PROJECT_ID || 'PVT_kwDOAA37OM4AFuzg',
  org: 'bcgov',
  repos: [
    'nr-nerds',
    'quickstart-openshift',
    'quickstart-openshift-backends',
    'quickstart-openshift-helpers'
  ],
  monitoredUser: process.env.GITHUB_AUTHOR || 'test-user',
  monitoredRepos: new Set([
    'bcgov/nr-nerds',
    'bcgov/quickstart-openshift',
    'bcgov/quickstart-openshift-backends',
    'bcgov/quickstart-openshift-helpers'
  ]),
  testData: {
    columns: {
      'New': 'optionId1',
      'Active': 'optionId2',
      'Done': 'optionId3'
    },
    sprints: {
      'Current Sprint': 'sprint-1',
      'Next Sprint': 'sprint-2'
    }
  }
};

// Ensure required environment variables are set
function checkEnv() {
  const required = ['GH_TOKEN'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }
}

// Clean up test data between runs
function cleanupTest() {
  // Could add cleanup logic here if needed
}

module.exports = {
  TEST_CONFIG,
  checkEnv,
  cleanupTest
};
