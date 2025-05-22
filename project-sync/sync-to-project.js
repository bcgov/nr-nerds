const { graphql } = require("@octokit/graphql");
const fs = require("fs");
const yaml = require("js-yaml");

const GH_TOKEN = process.env.GH_TOKEN;
const PROJECT_ID = process.env.PROJECT_ID; // GitHub Project (beta) node ID
const SPRINT_FIELD_ID = process.env.SPRINT_FIELD_ID; // Custom field node ID
const SPRINT_VALUE = process.env.SPRINT_VALUE; // e.g. "Sprint-2025-05-21"

const graphqlWithAuth = graphql.defaults({
  headers: { authorization: `token ${GH_TOKEN}` },
});

const repos = yaml.load(fs.readFileSync("transfer/repos.yaml")).repos;

async function addToProject(contentId) {
  // Add item to project
  const addRes = await graphqlWithAuth(`
    mutation($projectId:ID!, $contentId:ID!) {
      addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
        item { id }
      }
    }
  `, { projectId: PROJECT_ID, contentId });
  return addRes.addProjectV2ItemById.item.id;
}

async function setSprint(itemId) {
  // Set sprint field value
  await graphqlWithAuth(`
    mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $value:String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId,
        itemId: $itemId,
        fieldId: $fieldId,
        value: { text: $value }
      }) { projectV2Item { id } }
    }
  `, { projectId: PROJECT_ID, itemId, fieldId: SPRINT_FIELD_ID, value: SPRINT_VALUE });
}

async function processRepo(repo) {
  // Get closed issues and PRs in the last 2 days
  const [owner, name] = repo.split("/");
  const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  // Issues
  let issuesRes = await graphqlWithAuth(`
    query($owner:String!, $name:String!, $since:DateTime!) {
      repository(owner: $owner, name: $name) {
        issues(states: CLOSED, filterBy: {since: $since}, first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes { id, number, title, closedAt }
        }
      }
    }
  `, { owner, name, since });
  for (const issue of issuesRes.repository.issues.nodes) {
    const itemId = await addToProject(issue.id);
    await setSprint(itemId);
    // Optionally: move to Done column (requires column field id)
    console.log(`Added issue #${issue.number} to project`);
  }

  // PRs
  let prsRes = await graphqlWithAuth(`
    query($owner:String!, $name:String!, $since:DateTime!) {
      repository(owner: $owner, name: $name) {
        pullRequests(states: CLOSED, first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes { id, number, title, closedAt }
        }
      }
    }
  `, { owner, name, since });
  for (const pr of prsRes.repository.pullRequests.nodes) {
    const itemId = await addToProject(pr.id);
    await setSprint(itemId);
    // Optionally: move to Done column (requires column field id)
    console.log(`Added PR #${pr.number} to project`);
  }
}

(async () => {
  for (const repo of repos) {
    try {
      await processRepo(repo);
    } catch (e) {
      console.error(`Error processing ${repo}:`, e.message);
    }
  }
})();
