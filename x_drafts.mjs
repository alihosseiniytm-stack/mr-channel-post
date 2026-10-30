// Buffer drafts helper (runs in GitHub Actions, secrets from env). usage: node x_drafts.mjs list | delete <id> [<id>...]
const gql = async (query, variables) => { const r = await fetch("https://api.buffer.com", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + process.env.BUFFER_API_KEY }, body: JSON.stringify({ query, variables }) }); const j = await r.json(); if (!r.ok || j.errors) throw new Error("buffer " + r.status + " " + JSON.stringify(j.errors || j).slice(0, 500)); return j.data; };
const [cmd, ...ids] = process.argv.slice(2);
if (cmd === "list") {
  const org = (await gql(`query{account{organizations{id}}}`)).account.organizations[0].id;
  const d = await gql(`query($i:PostsInput!){posts(input:$i){edges{node{id text status}}}}`, { i: { organizationId: org, filter: { status: ["draft"], channelIds: [process.env.BUFFER_CHANNEL_ID] } } });
  for (const { node } of d.posts.edges) console.log(node.id, "|", node.status, "|", node.text.replace(/\n/g, " / ").slice(0, 110));
} else if (cmd === "delete") {
  for (const id of ids) { const d = await gql(`mutation($i:DeletePostInput!){deletePost(input:$i){__typename ... on VoidMutationError{message}}}`, { i: { id } }); console.log("delete", id, JSON.stringify(d.deletePost)); }
}
