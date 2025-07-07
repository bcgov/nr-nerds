const { graphql } = require('@octokit/graphql');

/**
 * @typedef {Object} ProjectItem
 * @property {string} id - The item's unique identifier
 * @property {'PullRequest'|'Issue'} type - The type of item
 * @property {Object} content - The item's content
 * @property {string} content.title - Item title
 * @property {number} content.number - PR/Issue number
 * @property {{login: string}} content.author - Item author
 * @property {{nameWithOwner: string}} content.repository - Repository info
 * @property {string} content.state - Item state (OPEN/CLOSED)
 * @property {boolean} [content.isDraft] - Whether PR is draft (PRs only)
 * @property {string} [content.reviewDecision] - Review state (PRs only)
 * @property {Object} fieldValues - Project board field values
 * @property {Array<{field: {name: string}, name: string}>} fieldValues.nodes - Field values
 * 
 * @example
 * // Example item structure that should be returned:
 * {
 *   id: "PVT_kwDOA...",
 *   type: "PullRequest",
 *   content: {
 *     title: "Add new feature",
 *     number: 123,
 *     author: { login: "username" },
 *     repository: { nameWithOwner: "bcgov/nr-nerds" },
 *     state: "OPEN",
 *     isDraft: false
 *   },
 *   fieldValues: {
 *     nodes: [
 *       { field: { name: "Status" }, name: "Active" },
 *       { field: { name: "Sprint" }, name: "Sprint 1" }
 *     ]
 *   }
 * }
 * 
 * @returns {Promise<{items: {nodes: ProjectItem[]}}>} Project board data
 * @throws {Error} If GraphQL query fails or response format is unexpected
 * 
 * @test {verifyBoardData} Verifies returned data matches expected structure
 * @test {verifyFieldValues} Ensures all required fields are present
 * @test {verifyNoMutations} Confirms query is read-only
 */
async function fetchBoardData() {
  // Uses GITHUB_TOKEN from environment
  const { node } = await graphql({
    query: `
      query {
        node(id: "PVT_kwDOAA37OM4AFuzg") {
          ... on ProjectV2 {
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
                      field {
                        ... on ProjectV2SingleSelectField {
                          name
                        }
                      }
                      name
                    }
                  }
                }
              }
            }
          }
        }
      }
    `,
    headers: {
      authorization: `token ${process.env.GITHUB_TOKEN}`
    }
  });

  return node;
}

module.exports = { fetchBoardData };
