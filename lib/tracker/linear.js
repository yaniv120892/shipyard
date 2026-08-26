const QUERY = `
query MyIssues($after: String, $first: Int!) {
  viewer {
    assignedIssues(
      first: $first, after: $after,
      filter: { state: { type: { in: ["unstarted", "started"] } } }
    ) {
      nodes { identifier title url branchName state { name } }
      pageInfo { endCursor hasNextPage }
    }
  }
}`;

export const linearProvider = {
  name: 'linear',
  async listMyOpenIssues(
    trackerCfg,
    { fetchImpl = fetch, apiKey = process.env.LINEAR_API_KEY } = {},
  ) {
    if (!apiKey) return { ok: false, reason: 'LINEAR_API_KEY not set' };
    const cap = trackerCfg.cap ?? 50;
    const issues = [];
    let after = null;
    try {
      while (issues.length < cap) {
        const res = await fetchImpl('https://api.linear.app/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: apiKey },
          body: JSON.stringify({ query: QUERY, variables: { after, first: Math.min(50, cap) } }),
        });
        const body = await res.json();
        if (body.errors?.length) return { ok: false, reason: body.errors[0].message };
        const page = body.data.viewer.assignedIssues;
        for (const n of page.nodes) {
          if (issues.length >= cap) break;
          issues.push({
            identifier: n.identifier,
            title: n.title,
            url: n.url,
            branchName: n.branchName ?? null,
            state: n.state.name,
          });
        }
        if (!page.pageInfo.hasNextPage) break;
        after = page.pageInfo.endCursor;
      }
      return { ok: true, issues };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  },
};
