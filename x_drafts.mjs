// Buffer drafts helper (runs in GitHub Actions, secrets from env). usage: node x_drafts.mjs list | sent | delete <id> [<id>...]
const gql = async (query, variables) => { const r = await fetch("https://api.buffer.com", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + process.env.BUFFER_API_KEY }, body: JSON.stringify({ query, variables }) }); const j = await r.json(); if (!r.ok || j.errors) throw new Error("buffer " + r.status + " " + JSON.stringify(j.errors || j).slice(0, 500)); return j.data; };
const [cmd, ...ids] = process.argv.slice(2);
if (cmd === "list") {
  const org = (await gql(`query{account{organizations{id}}}`)).account.organizations[0].id;
  const d = await gql(`query($i:PostsInput!){posts(input:$i){edges{node{id text status}}}}`, { i: { organizationId: org, filter: { status: ["draft"], channelIds: [process.env.BUFFER_CHANNEL_ID] } } });
  for (const { node } of d.posts.edges) console.log(node.id, "|", node.status, "|", node.text.replace(/\n/g, " / ").slice(0, 110));
} else if (cmd === "sent") { // T50-09 (11-12): READ-ONLY list of sent posts + the gap between them (live check: no double post, spacing >= 90 min)
  const org = (await gql(`query{account{organizations{id}}}`)).account.organizations[0].id;
  const q = (f) => gql(`query($i:PostsInput!){posts(input:$i){edges{node{id status text ${f}}}}}`, { i: { organizationId: org, filter: { status: ["sent"], channelIds: [process.env.BUFFER_CHANNEL_ID] } } });
  let d, f = "sentAt"; try { d = await q(f); } catch (e) { console.log("sentAt not available:", e.message.slice(0, 160)); f = "createdAt"; d = await q(f); }
  const rows = d.posts.edges.map(({ node }) => ({ ...node, t: Date.parse(node[f]) })).filter((r) => r.t).sort((a, b) => a.t - b.t).slice(-20), seen = new Set();
  for (const [i, r] of rows.entries()) { const gap = i ? Math.round((r.t - rows[i - 1].t) / 60e3) : null, k = r.text.replace(/https?:\/\/\S+/g, "").slice(0, 80); console.log(new Date(r.t).toISOString(), "| gap", gap ?? "-", "min |", seen.has(k) ? "DOUBLE" : "uniq", "|", r.text.replace(/\n/g, " / ").slice(0, 90)); seen.add(k); }
  console.log("sent rows", rows.length, "| field", f);
} else if (cmd === "delete") {
  for (const id of ids) { const d = await gql(`mutation($i:DeletePostInput!){deletePost(input:$i){__typename ... on VoidMutationError{message}}}`, { i: { id } }); console.log("delete", id, JSON.stringify(d.deletePost)); }
}
