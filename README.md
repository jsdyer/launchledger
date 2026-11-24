# Launch Ledger

[Open Launch Ledger](https://coolcode.ca/launchledger/) · [Launch Library 2](https://thespacedevs.com/llapi)

A browser application that keeps dated observations of launch schedules and provider-reported outcomes. Search by mission, rocket, provider or launch UUID; filter by provider, pad, status and reported date; compare any two retained captures and inspect a launch's observation history. Export a capture JSON or the filtered records as CSV. Import an older receipt to compare it locally.

<!-- coolcode:guide -->
Choose a capture and an earlier comparison, then select a launch to see changes to its reported time, precision, status and pad. History begins with the first collection; a passed NET date does not prove liftoff. Edit web/config.json to expand the date window or add launch UUIDs to watchIds, then push to main to refresh automatically. Downloads keep your own copy; imported receipts stay in the current tab.
<!-- /coolcode:guide -->

## Expand the collection

The source list is deliberately configurable. Edit [`web/config.json`](web/config.json) directly in GitHub. No API key or registration is required for the default collection.

| Setting | Current default | How to change it |
| --- | --- | --- |
| `lookbackDays` | 14 | Retain recent launches in each new capture long enough to observe reported outcomes. Range 0–3650. |
| `lookaheadDays` | 90 | Increase the future window. Range 1–3650. Broad dates remain broad. |
| `search` | `""` | A provider-side text query such as `"Electron"`; blank includes all matches in the date window. |
| `providerId` | `""` | Optional Launch Library agency ID, e.g. `"121"` for SpaceX; blank includes all providers. IDs are visible in the provider's launch API record. |
| `watchIds` | `[]` | Add up to six launch UUIDs. These launches are retained even after their NET leaves the rolling window. Copy a launch UUID from its detail card. |
| `pageSize` | 100 | Provider records per page, 1–100. |
| `maxPages` | 2 | Pages to collect for the date window, 1–4. If more results exist, collection fails and preserves the last good capture. Narrow the window/search or increase this limit within the request budget. |
| `maxRequests` | 8 | Hard request cap per run, 1–8. Must be at least `maxPages + watchIds.length`. |
| `historyLimit` | 120 | Number of capture files retained in the published site, 2–365. Older files remain in Git history but leave the UI; export any receipt you need. |
| `apiBase` | `https://ll.thespacedevs.com/2.3.0` | Production data. The only alternative is `https://lldev.thespacedevs.com/2.3.0` for development: it contains stale data. |

Example: set `search` to `"Electron"` to capture the selected rolling schedule, or leave search blank and put a specific launch UUID in `watchIds` to follow that mission beyond the date window. The public UI filters the retained collection instantly; changing a browser filter does not make an API request or alter the public collection.

## Refresh and publication

The **Launch Ledger · Capture, check and publish** GitHub Actions workflow runs:

- Daily at approximately **05:43 UTC**. GitHub schedules can run late and are not a live countdown service.
- When a push to `main` changes `web/config.json` or `scripts/refresh.py`.
- Manually from **Actions → Launch Ledger · Capture, check and publish → Run workflow**, with **refresh** checked. Clear it for an offline rebuild.

The collector uses Python's standard library, makes at most eight requests per run (normally two), waits one second between calls, validates every response and never retries a rate-limit error aggressively. A 403, 429, bad schema, exceeded page cap or missing watch record aborts collection. Existing files and the published site remain unchanged; inspect the failed workflow and retry later. Successful captures are committed to `web/data/` after tests, then deployed in the same workflow. The Actions token needs repository contents write permission; Pages must use **GitHub Actions**. Branch protection that blocks the bot from committing captures must be adjusted by the owner or replaced with an approved PR-based retention workflow.

Ordinary source pushes rebuild/test/publish without contacting Launch Library. Pull requests always use retained data and never deploy or collect. Public repository schedules can be disabled by GitHub after 60 days without activity. After three days without a new successful capture, the app displays a freshness warning.

## How to interpret comparisons

- Matching is by stable Launch Library launch UUID, never by the displayed name.
- Changes include reported NET, precision, status, launch window, provider, pad, rocket and failure note. `last_updated` is a provider edit time, separate from our `capturedAt` receipt time.
- A launch absent from a new capture may have moved outside its date window, fallen outside capped pages, or stopped matching its search. It is never automatically labelled cancelled or deleted.
- “New to this capture” does not mean a newly announced launch. Comparisons only cover records present in both captures; the UI reports differing coverage.
- NET means no earlier than. Month/quarter/year precision is displayed as such. A numeric time shift is shown only when both reported times have minute/second precision. No forecast-versus-actual error score is inferred from NET.
- A success or failure label is the provider's report. It is not independently verified telemetry. Dates can change between daily observations and those intermediate changes will not be recoverable.
- There is no fabricated past baseline. The initial published receipt contains 113 real launches collected on 2026-11-23; later runs create the history.

## Sources, terms and privacy

Launch Library 2 **v2.3.0** is supplied by **The Space Devs**. Official references checked on 2026-11-23:

- [API documentation](https://ll.thespacedevs.com/docs/) and [launch endpoint](https://ll.thespacedevs.com/2.3.0/launches/).
- [Provider FAQ and terms](https://github.com/TheSpaceDevs/Tutorials/blob/main/faqs/faq_TSD.md): free use of data with added value; attribution encouraged; no guarantee of complete accuracy. This app adds retained capture history and comparisons. It does not mirror the raw database or reproduce provider images.
- [Free tier](https://thespacedevs.com/llapi): 15 unauthenticated calls per hour. The FAQ recommends caching and avoiding direct user-client API queries. Only the scheduled/owner-run collector accesses the provider. Keep repeated manual runs within the hourly limit; higher access is optional through the provider.

Only normalized launch metadata is retained. Provider media have separate licenses and are not included. The site is a static GitHub Pages app; search/filter inputs and imported receipts are processed in tab memory and not stored in browser storage. Downloads happen only on request. The shared CoolCode counter records aggregate opens. Source links take you to an external provider only when clicked.

## Develop and verify

```sh
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -v
python3 scripts/build.py
```

The default build is offline. `python3 scripts/refresh.py` explicitly collects a new capture with the production request budget. Use the development endpoint for repeated collector development; never confuse that stale test data with production history. Browser tests in `tests/browser_smoke.py` run in GitHub Actions against the built `/launchledger/` project subpath and check imports, safe rendering, comparisons, exports and mobile overflow.

Source lives in `web/`, collection in `scripts/refresh.py`, and the root `tool.json` is the CoolCode catalogue record. Keep project assets relative; do not add a CNAME. Do not commit `dist/` or secret values.

<!-- schedule-reliability -->
## Schedule reliability

Public GitHub repositories can have scheduled workflows disabled after 60 days of inactivity. A separate weekly [schedule guard](.github/workflows/schedule-guard.yml) calls GitHub's enable-workflow API for an explicit list of refresh workflows and itself. It can restore workflows disabled for inactivity, preserves manually disabled workflows, and runs independently of collection failures.

This is an interim mitigation, not a scheduling guarantee: GitHub does not document active-workflow renewal as a permanent exemption, and scheduled runs can be delayed or dropped. A scheduler on our own Linux server is the planned independent trigger. The guard does not collect data, create dummy commits, or change source/check timestamps; successful collection and published data freshness still need monitoring.
<!-- /schedule-reliability -->
