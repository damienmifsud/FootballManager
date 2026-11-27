// The scheduled Dribl reader (lib/driblRun.js), as GitHub runs it
// (.github/workflows/dribl-sync.yml). Everything it needs comes from the
// workflow's environment:
//   SITE_URL           the site's address (a GitHub variable)
//   CRON_SECRET        the site's scheduled-job key (a GitHub secret, the same value as on the site)
//   DRIBL_CLUB_KEY     optional: the value Dribl agreed to let through (a GitHub secret)
//   DRIBL_CLUB_HEADER  optional: that header's name, when Dribl chose one other than X-Club-Sync
// It fails (exit 1) when anything could not be done, so the run shows red.
import { runDriblSync } from "../lib/driblRun.js";

const result = await runDriblSync({
  site: process.env.SITE_URL,
  cronKey: process.env.CRON_SECRET,
  clubKey: process.env.DRIBL_CLUB_KEY || "",
  clubHeader: process.env.DRIBL_CLUB_HEADER || ""
});
process.exitCode = result.ok ? 0 : 1;
