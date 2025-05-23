// Minimal script: assign all open/closed PRs by GITHUB_AUTHOR to GITHUB_AUTHOR using REST API
const { Octokit } = require("@octokit/rest");
const fs = require("fs");
const yaml = require("js-yaml");

const GH_TOKEN = process.env.GH_TOKEN;
const GITHUB_AUTHOR = process.env.GITHUB_AUTHOR || "DerekRoberts";
const octokit = new Octokit({ auth: GH_TOKEN });

const repos = yaml.load(fs.readFileSync("project-sync/repos.yml")).repos;

async function assignPRsInRepo(repo) {
  const [owner, name] = repo.split("/");
  let page = 1;
  let found = 0;
  const sinceDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
  while (true) {
    const { data: prs } = await octokit.pulls.list({
      owner,
      repo: name,
      state: "all",
      per_page: 50,
      page
    });
    if (prs.length === 0) break;
    for (const pr of prs) {
      if (
        pr.user && pr.user.login === GITHUB_AUTHOR &&
        (
          pr.state === "open" ||
          (pr.state === "closed" && pr.merged_at && new Date(pr.merged_at) >= sinceDate)
        )
      ) {
        await octokit.issues.addAssignees({
          owner,
          repo: name,
          issue_number: pr.number,
          assignees: [GITHUB_AUTHOR]
        });
        console.log(`Assigned PR #${pr.number} to ${GITHUB_AUTHOR}`);
        found++;
      }
    }
    page++;
  }
  if (found === 0) console.log(`No matching PRs by ${GITHUB_AUTHOR} found in ${repo}`);
}

(async () => {
  for (const repo of repos) {
    try {
      const fullRepo = repo.includes("/") ? repo : `bcgov/${repo}`;
      await assignPRsInRepo(fullRepo);
    } catch (e) {
      console.error(`Error processing ${repo}:`, e.message);
    }
  }
})();
