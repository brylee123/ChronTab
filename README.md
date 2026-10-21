# Chrontab

A standalone Manifest V3 extension for Chrome, Edge, Brave, Vivaldi, and other Chromium browsers (Chromium 120+). Snooze a tab once or bring it back on a custom calendar schedule.

## Install locally

1. Download **Chrontab-1.1.0.zip** from the [latest release](https://github.com/brylee123/ChronTab/releases/latest) and extract it.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the extracted folder containing `manifest.json`.
5. Pin Chrontab to the toolbar.

If you cloned the source repository, run the build commands below and load the generated **dist** folder instead. No account or server is required to use the extension.

## Appearance

Chrontab uses Material UI (MUI) theming, CssBaseline, and segmented appearance controls, with matching Material palette tokens across the dashboard, popup, and recurrence picker. Choose **Light**, **Dark**, or **System** in either page. The preference is saved locally, shared across open Chrontab pages, and restored before paint. System mode follows the operating system’s appearance. All dependencies are bundled in the extension; runtime use requires no CDN or network connection.

Design references: [MUI showcase](https://mui.com/material-ui/discover-more/showcase/) and [MUI dark mode](https://mui.com/material-ui/customization/dark-mode/).

## Snooze a tab

Open an HTTP or HTTPS page and click the Chrontab toolbar button. Use an hour, tomorrow at 9 AM, or a week as a shortcut, or choose a date and time. Select **Repeat** for the custom recurrence dialog, then **Snooze this tab**.

Chrontab saves the schedule before closing the original tab. It saves the URL and pinned state, not page content, forms, scroll position, login sessions, or unsaved work. Private/incognito tabs and browser-internal, file, and extension URLs cannot be snoozed.

Open the management page using the popup’s arrow, the Chrontab name, or the extension’s **Options**. You can also schedule a URL directly without closing a tab.

## Calendar view

Choose **Calendar** on the dashboard to see a month of upcoming tab reopenings. Recurring wakeups are projected through the same rule engine used by the background scheduler. Move between months, return to today, toggle date-list overlays, select a day for its full agenda, or select a wakeup to edit the tab. Paused tabs are omitted. Projected dates may change when you edit lists or when delayed wakeups consume occurrences.

## Date lists

Choose **Date lists → New date list**:

- **Regional holidays**: select a country, optional state/province and subdivision, holiday categories, and whether to include observed/substitute days.
- **Workdays & hours**: use the seven-day timeline to drag out blue time blocks, or select a block and edit its exact start/end. Multiple shifts per day are supported. Work blocks include their start and exclude their end. Split overnight shifts into two blocks at midnight; end time may be 24:00. Optional regional holidays are excluded automatically.
- **Custom dates**: add labeled single dates or inclusive ranges. Each entry can repeat annually or exclude dates from the list. Split annual ranges crossing New Year into two entries.

Regional and workday lists also accept date overrides. An included workday date can re-enable a holiday but still respects that weekday’s hours. Excluded overrides take priority. No country is assumed. You can keep several regional and work schedules.

Use **View dates** on any list to inspect a year of its dates and names. Lists assigned to a tab cannot be deleted until their references are removed. Editing a list recalculates assigned schedules without resetting completed occurrence counts; paused schedules stay paused.

Holiday data comes from the bundled [date-holidays](https://github.com/commenthol/date-holidays) database, not a live Home Assistant connection. Data updates ship with extension updates. Its country/subdivision coverage and classifications can differ from Home Assistant’s Python holidays database. Lists support dates from 2000 through 2199. The packaged notices retain the data and code attribution.

## Wake rules and exclusions

In a tab editor, open **Calendar lists & date rules**, enable **Use date rules**, and select conditions in nested **All of** (AND) or **Any of** (OR) groups. **Assigned schedule** means the tab’s selected date/recurrence. Each list is another selectable condition. A group can contain more groups. Add a separate **Except when** group for exclusions; matching an exclusion always prevents automatic opening.

For example: **All of [Any of [Assigned schedule; Regional holidays]; Office hours]**, except **Time off**.

All matching dates use the tab’s chosen local start time. A work-hours condition must contain that time. The assigned-schedule condition follows the repeat interval; list conditions may add other dates through an Any group. Recurrence endings and occurrence counts apply to all resulting reopenings.

Date-list conditions conflict with **Does not repeat**: Chrontab displays a warning and disables saving until you select a recurrence or remove all date-list conditions. The worker and JSON import validate the same restriction. Skipped dates do not consume an occurrence, and dates are not shifted to the next workday. Exclusions and work hours are checked again for overdue automatic wakeups. Manual **Open now** remains an explicit override.

A live preview shows the next qualifying wakeups. Empty groups, missing lists, invalid hours, and no matching dates must be resolved before a schedule can be saved. Excessively broad/contradictory rules can reach the evaluation limit; simplify them when prompted. If a saved rule has no remaining matches after a list change, it is retained and paused with an explanation.

## Custom recurrence

The picker follows Google Calendar’s layout: **Repeat every** N days/weeks/months/years, weekday buttons, and endings of **Never**, **On** a date, or **After** a number of occurrences.

- Weekly rules support several weekdays and intervals such as every two weeks.
- Monthly rules support the same date or the same ordinal weekday (for example, the second Tuesday).
- A missing calendar date is skipped: January 31 repeats on March 31, and February 29 repeats in leap years. Fifth weekday rules also skip months without that weekday.
- The start date is the earliest allowed occurrence. If it is not a selected weekday, the first matching weekday is used.
- End dates are inclusive. Occurrence counts include the first actual reopening.
- **Open now** consumes the pending occurrence; a recurring schedule continues from the following scheduled occurrence.
- Editing a schedule resets its start and completed occurrence count.
- **Pause** holds the schedule. Resuming an overdue schedule reopens it shortly.

## Timing and recovery

Calendar rules follow the device’s local wall-clock time, including daylight saving changes. During a spring-forward gap, JavaScript moves the nonexistent time forward by the gap. In a repeated autumn hour, the earlier occurrence is used. Future dates follow the current device time zone; this version does not offer a fixed time zone per schedule.

Schedules persist in `chrome.storage.local`. The service worker recreates its next alarm on startup and whenever it starts. One alarm handles the whole queue. Missed recurring wakeups are combined into one reopening, then the next future calendar occurrence is scheduled. Missed dates do not consume extra occurrences.

The browser must be running to open tabs, and alarms can be delayed by device sleep or browser scheduling. Failed reopenings are kept and paused for a manual retry. As with browser extensions generally, an abrupt crash between opening a tab and saving the updated queue can reopen that tab again after recovery.

## JSON backups

Use **Export JSON** on the management page. **Import** merges a Chrontab backup with the saved queue, skips existing IDs, validates the entire file before saving, and reports added/skipped counts. Importing an overdue schedule may open it shortly after import. Import preserves next wake times, repeat rules, completion counts, and paused state.

New exports use version 2, including date lists and nested conditions. Version 1 imports remain supported. Existing IDs are kept when merging; imported rules referencing an existing list ID use that existing list definition. Version 2 files have this envelope:

```json
{
  "format": "chrontab",
  "version": 2,
  "exportedAt": "2027-01-01T12:00:00.000Z",
  "tabs": [],
  "dateLists": []
}
```

Limits: 5,000 schedules, 100 date lists, 2,000 date entries per list, and an 8 MB import file. Browser storage quotas still apply. Backups contain URLs and titles; keep them where you would keep bookmarks. Export backups before uninstalling, as uninstalling removes local extension storage.

## Privacy and permissions

No analytics, remote scripts, website content access, external requests, or account sync. All interface icons and the application logo use official [Pictogrammers Material Design Icons](https://pictogrammers.com/library/mdi/) from the bundled @mdi/js package; the extension does not fetch favicons.

- `activeTab`: read the current page’s URL and title after you click the toolbar icon.
- `storage`: save schedules on this device.
- `alarms`: reopen tabs when due.

## Icons

The application logo is MDI **alarm-snooze**, used unchanged in the interface and rasterized into the 16, 32, 48, and 128 px extension icons. Navigation, actions, appearance toggles, empty states, select arrows, calendar indicators, and search clearing also use MDI paths. Icons inherit the selected light or dark palette.

Run `pnpm icons:generate` to regenerate logo PNGs, the source logo SVG, and native-control indicators. `pnpm build` runs this automatically. See `icons/LICENSE-MDI.txt` for the icon license.

## Development and verification

With Node.js 22.12+ and pnpm installed:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

Load dist as the unpacked extension after building. The source HTML files depend on the build step. After installing dependencies, unit tests can also run directly: `node --test tests/*.test.js`. Tests cover recurrence boundaries, DST behavior, validation, service worker scheduling, import merging, storage failures, and concurrent writes.

After loading unpacked, manually verify:
1. Snooze a disposable webpage for one minute from now; verify closure and reopening.
2. Create a weekly rule with several days and each ending option.
3. Edit, pause, resume, open now, and delete schedules.
4. Export, remove a schedule, and reimport the JSON; verify duplicates are skipped.
5. Close and reopen the browser after a wake time; verify one recovery opening.
6. Repeat in your other Chromium browser.

Real-browser verification is in `tests/browser-check.mjs`. It uses Playwright with an isolated headless Edge profile; the default Playwright import points at the Codex bundled runtime on this machine. Set PLAYWRIGHT_MODULE to your local Playwright module path and CHRONTAB_BROWSER to a Chromium executable if needed. Run `pnpm test:browser` and `pnpm test:calendar` after building. The second check covers the weekly grid, list management, conflict blocking, nested groups, calendar projection, and version 2 backups. The check exercises the actual loaded extension, recurrence creation, pause/resume, filters, JSON round trips, theme persistence and system changes, popup rendering, and an automatic alarm reopening a local test page. Popup rendering injects a sample current-tab result; real toolbar activeTab permission should also be checked manually.

The extension has not been published to a browser store.
