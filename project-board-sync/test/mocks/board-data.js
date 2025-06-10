const { graphql } = require('@octokit/graphql');

/**
 * Fetches real board data for testing
 * Read-only - no mutations allowed
 */
async function fetchBoardData() {
  // Uses GH_TOKEN from environment
  const { project } = await graphql({
    query: `query {
      project(number: 1) {
        items(first: 100) {
          nodes {
            id
            type
            content {
              ... on PullRequest {
                title
                number
                author { login }
                repository { nameWithOwner }
                state
                isDraft
                reviewDecision
              }
              ... on Issue {
                title
                number 
                author { login }
                repository { nameWithOwner }
                state
              }
            }
            fieldValues(first: 8) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  field { name }
                  name
                }
              }
            }
          }
        }
      }
    }`,
    headers: {
      authorization: `token ${process.env.GH_TOKEN}`
    }
  });

  return project;
}

module.exports = { fetchBoardData };
