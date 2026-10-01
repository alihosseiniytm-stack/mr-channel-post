// Deno Deploy: set this file as the entrypoint.
import { handle } from "./handler.mjs";
Deno.serve((req) => handle(req, Deno.env.toObject()));
