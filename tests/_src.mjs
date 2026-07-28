// The one place that knows how the app is assembled. Every test imports `src`
// from here and sees the document the way the BROWSER sees it: index.html with
// its local <link rel="stylesheet"> and <script src> inlined back in place.
//
// This exists because the app stopped being one file (2026-07-28). Eighteen
// tests each carried `readFileSync(index.html)`; the day the script moved to
// app.js, every one of them would have gone on green-testing an <html> shell
// with no code in it -- the "ships green but never runs" shape, applied to the
// entire suite at once. Inlining here keeps each test's grab()/regex logic
// byte-identical to before the split.
//
// A referenced file that cannot be read is a HARD failure, not a skipped tag:
// silently testing the shell without its script is the exact defect this file
// was written to prevent.
import fs from "fs";
import path from "path";

export const APP = process.env.APP_HTML || new URL("../index.html", import.meta.url).pathname;
const dir = path.dirname(APP);

const inline = (m, ref, open, close) => {
  if (/^https?:/.test(ref)) return m;          // remote refs stay remote
  const p = path.join(dir, ref);
  let body;
  try { body = fs.readFileSync(p, "utf8"); }
  catch { throw new Error("HARNESS FAILED -- " + APP + " references " + ref + " but it is not readable at " + p); }
  return open + "\n" + body + close;
};

export const src = fs.readFileSync(APP, "utf8")
  .replace(/<link rel="stylesheet" href="([^"]+)"[^>]*>/g, (m, h) => inline(m, h, "<style>", "</style>"))
  .replace(/<script src="([^"]+)"><\/script>/g, (m, s) => inline(m, s, "<script>", "</script>"));
