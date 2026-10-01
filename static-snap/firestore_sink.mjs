// Writes every public/snap/*.json into Firestore (project mr-mirror-61fd2) as docs snap/<name> {j: "<json text>", at: <ISO>}. Uses the service account JSON from the file given as argv[2].
import fs from "node:fs"; import crypto from "node:crypto";
const sa = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const dir = process.argv[3] || "public/snap";
const b64 = (b) => Buffer.from(b).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const hdr = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
const body = b64(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3000 }));
const sig = crypto.sign("RSA-SHA256", Buffer.from(hdr + "." + body), sa.private_key).toString("base64url");
const tr = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + hdr + "." + body + "." + sig })).json();
if (!tr.access_token) { console.log("firestore sink: no token", JSON.stringify(tr).slice(0, 200)); process.exit(0); }
const base = "projects/" + sa.project_id + "/databases/(default)/documents";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
const at = new Date().toISOString();
const writes = [];
for (const f of files) {
  const txt = fs.readFileSync(dir + "/" + f, "utf8");
  if (txt.length > 900000) continue;
  writes.push({ update: { name: base + "/snap/" + f.replace(/\.json$/, "").replace(/~/g, "_"), fields: { j: { stringValue: txt }, at: { stringValue: at } } } });
}
let ok = 0, bad = 0;
for (let i = 0; i < writes.length; i += 20) {
  const r = await fetch("https://firestore.googleapis.com/v1/" + base.split("/documents")[0] + "/documents:commit", { method: "POST", headers: { authorization: "Bearer " + tr.access_token, "content-type": "application/json" }, body: JSON.stringify({ writes: writes.slice(i, i + 20) }) });
  if (r.ok) ok += Math.min(20, writes.length - i); else { bad++; console.log("commit", r.status, (await r.text()).slice(0, 200)); }
}
console.log("firestore sink: wrote", ok, "docs, failed batches", bad);
