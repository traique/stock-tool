export default async function handler(req, res) {
  try {
    const owner = process.env.GITHUB_REPO_OWNER;
    const repo = process.env.GITHUB_REPO_NAME;
    const workflow = process.env.GITHUB_WORKFLOW_FILE || "manual-update.yml";
    const ref = process.env.GITHUB_REF || "main";
    const token = process.env.GITHUB_WORKFLOW_TOKEN;

    if (!owner || !repo || !token) {
      return res.status(500).json({
        error: "Thiếu env",
        debug: {
          hasOwner: !!owner,
          hasRepo: !!repo,
          hasToken: !!token,
          workflow,
          ref,
        },
      });
    }

    const ghUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}`;
    const infoRes = await fetch(ghUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });

    const infoText = await infoRes.text();

    return res.status(infoRes.status).json({
      url: ghUrl,
      status: infoRes.status,
      response: infoText,
      debug: {
        owner,
        repo,
        workflow,
        ref,
      },
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unknown server error",
    });
  }
}
