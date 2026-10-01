// Netlify Functions v2: every path is routed here (config.path).
import { handle } from "../../handler.mjs";
export default async (req) => handle(req, process.env);
export const config = { path: "/*" };
