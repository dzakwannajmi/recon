# Run the Monitor on a schedule (macOS launchd)

The Monitor (`npm run monitor`) reads Stellar mainnet through Horizon every few hours.
It records issuer events and daily mint and burn sums, and re-runs the deterministic checks when the
plan says so. It never publishes, never runs git, never calls a model, and loads no environment file.

This folder holds a launchd agent template that runs it every 6 hours at minute 17 (local time).

## Install

1. Find your paths: `which npm`, your repository checkout, and `echo $HOME`.
2. Create the agent file from the template (replace the three placeholders):

   ```sh
   cd <repo>/frontend/scripts/launchd
   sed -e "s|__NPM__|$(which npm)|" -e "s|__REPO__|<repo>|" -e "s|__HOME__|$HOME|" \
     monitor.plist.template > ~/Library/LaunchAgents/local.monitor.watch.plist
   plutil -lint ~/Library/LaunchAgents/local.monitor.watch.plist
   ```

3. Load it:

   ```sh
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.monitor.watch.plist
   launchctl print gui/$(id -u)/local.monitor.watch | head
   ```

4. Test one run now (the same command the agent runs; add `-- --dry-run` to write nothing):

   ```sh
   cd <repo>/frontend && npm run monitor -- --dry-run
   ```

## Things to know

- **macOS may block background access to `~/Documents`** ("Operation not permitted" in
  `~/Library/Logs/monitor.log`). Either allow it (System Settings, Privacy and Security, Files and
  Folders or Full Disk Access for the program that runs the job), or run the Monitor by hand.
- **A sleeping Mac is fine.** launchd runs a missed job once on wake. The watch is cursor-based over about
  a year of Horizon history, so a missed run delays detection and loses nothing.
- **Output** goes to `~/Library/Logs/monitor.log`. Exit codes: 0 done, 1 refused (lock, records, frozen
  inconsistency), 2 partial (a request budget ended a watch; state saved), 3 a pipeline step failed.
- **Budget:** at most 2 re-checks per UTC day, at least 120 minutes apart, at most 300 Horizon requests
  per run, and none from 23:45 to 00:15 UTC. The four settings are `MONITOR_MAX_RUNS_PER_DAY` (hard max
  4), `MONITOR_MIN_GAP_MINUTES` (30 to 720), `MONITOR_MAX_REQUESTS` (hard max 1000), and
  `MONITOR_MAX_PAGES_PER_ISSUER` (hard max 200). Set them in the plist's `EnvironmentVariables` if you change them.
- **Files it writes:** `data/monitor/state.json`, `data/monitor/log.json`, `data/monitor/issuance/`, and
  (on a re-check) the day's `data/checks`, `data/examinations`, and `data/status` files. A day file that a
  published status used is never overwritten.
- **It never commits.** Review the changes under `data/` and commit them in a pull request. A re-check can
  change a status (including LARGE_MINT_BURN): read the diff in the run summary before anyone publishes.
- **Preparing a publish?** Stop the job first (`launchctl bootout gui/$(id -u)/local.monitor.watch`), or run
  `npm run monitor -- --no-recheck` by hand, so no re-check replaces an unpublished day file under you.
  Load it again afterwards.

## Remove

```sh
launchctl bootout gui/$(id -u)/local.monitor.watch
rm ~/Library/LaunchAgents/local.monitor.watch.plist
```
