# Bots catch up once after a gap, and the desktop starts at login

Bots run inside the API, and on a desktop the API runs inside Timely (ADR
0011). When Timely is closed or the computer sleeps, no Bot checks anything.
This ADR records how Timely keeps that gap short (it starts when the person
signs in), how it catches up when the gap is over (each late Bot checks once,
one after another, and says how long it was paused), and how a Bot alert then
reaches the phone in seconds instead of at the next poll. Each part has a rule
that keeps it honest: Timely never pretends nothing happened, never re-enables
something the person or the system turned off, and never sends alert text to
a third party the person asked it to keep out of.

## Catch-up

**One schedule, one wake check per Bot.** `bots.next_check_at` stays the only
schedule, and a check job is keyed `bot_check:<id>`. A Bot that missed nine
hourly slots is simply overdue, so it gets **one** check when Timely is back,
however many slots it missed. Nothing replays the missed slots.

**The scheduler's wall-clock gap is the only wake signal.** The job worker
sweeps every 10 seconds and compares wall clocks, not the monotonic clock,
which stops while the computer sleeps. The first sweep of a process, or a
sweep more than a minute after the last one, is a wake. There is no wake
endpoint and Electron's `powerMonitor` is not used (see "Why no wake
endpoint" below).

**Late checks start one by one on one tail.** The service keeps a `wakeTail`
under its lock. Every wake check, from a wake sweep or from any later sweep
that finds a Bot more than 10 minutes late, takes the next slot:
`slot = max(wakeTail, now + 30 s) + 10 s`, it starts at that slot plus up to
5 s of jitter, and the tail moves to the slot. Consecutive starts are at least
5 seconds apart, so 25 Bots take about 4 minutes, 200 about 33, and the three
check slots never see a pile-up. Batches of 200 continue the same tail instead
of stacking on each other's slots. There is no upper clamp: on a big server
450 overdue Bots take about 75 minutes, which is slow by design.

**A sweep never re-picks a Bot that already has a check waiting.** The due
query skips Bots with a pending or running `bot_check` job, so each sweep
takes the next oldest rows. On a wake sweep, pending check jobs whose start
time already passed (queued before the close) are first moved onto the tail,
one by one in their old order, and marked `trigger: wake`. Without that they
would all start at once, ahead of a person's "Check now". A check the person
asked for (Check now, a chat tag) keeps its time and trigger: it runs whether
or not the Bot is due, and a wake trigger would lose its claim.

**How long a Bot was paused lives on the Bot row.** A wake sweep marks every
active Bot at least 30 minutes late, in accounts without Pause all, with one
`UPDATE … RETURNING`: `away_since` (kept while no check has run since the
last mark; a check that read nothing ends that gap, so the next mark starts a
new one), `away_until` and `away_reason`. Turning Pause all off marks the same way, from the later of the
Bot's next check and the moment Pause all went on. Keeping it on the row means
it survives a job queued before the close, a retry and a shutdown that
releases a running job, and one UPDATE marks every late Bot, not just the 200
in the current batch.

**Three reasons, with fixed words.** `closed` is the first sweep of a process
("while Timely was closed"), `asleep` a later sweep after a gap ("while this
computer was asleep"), `all_paused` turning Pause all off ("while all bots
were paused"). Timely knows which one happened, and the owner's rule is never
to pretend nothing did.

**The next check that reads something says it.** The first check after the
mark records the gap on its `bot_checks` row (`away_secs`, `away_reason`). If
it alerts, the alert's body ends with one line, such as "Paused for 9 hours
while Timely was closed", kept in `figures.away` too. That holds for judged,
judged-quiet, unchecked and rules alerts, and for a Brief's alert. A later
re-judge keeps the line, and the judge never sees it in a past alert's body.
Saving clears the Bot's fields, except when the check read nothing: offline,
wait and superseded problems, and an ok save whose outcome is superseded,
record the line on the check but keep it on the Bot, because the Bot has not
caught up yet. A strike pause clears it.

**Paused Bots stay as they are.** The mark only looks at active Bots, so a
paused Bot is never marked. A snoozed Bot is active: it catches up, and its
alert is held as any snoozed alert is. Pausing, resuming and the strikes pause
clear the fields, and so does a restore, for every Bot of the account inside
the restore's transaction; backups no longer carry them. A resumed or restored
Bot did not miss anything.

**One account alert per gap, by reason.** Each account with marked Bots gets
one alert: "Timely was closed. 3 bots are checking now." or "This computer was
asleep. …". The count and the earliest time come from the mark's RETURNING
rows, so they cover every batch. It goes to the phone only when at least one
marked Bot has its Phone switch on. Because `away_since` is kept, a second
restart before the catch-up finds the first alert and sends none.

## Start at login

**On by default, for new installs and upgraders.** The desktop config gains
`startAtLogin`, on by default. An install that predates it is exactly one
whose `config.json` exists without that key: it is set on, with
`loginNoticePending`, and saved at once. No version comparison is needed.

**One Electron-free module per platform.** `electron/supervisor/loginItem.ts`
takes the platform, environment, executable path, file system and Electron's
login API as arguments, so all three platforms are unit-tested on Linux.
- **Windows** (first): `setLoginItemSettings` with the executable, the
  argument `--hidden`, and the name `FLAVOR.appId`, because Electron's
  Windows login item reads the Run value named after the AppUserModelId. The
  state is read from `launchItems` by that name. The path is always the
  running executable, never a value from the environment.
- **Linux**: Electron's login API does nothing there, so Timely writes
  `$XDG_CONFIG_HOME/autostart/timely.desktop` (`timely-dev.desktop` for the dev
  flavor; a relative `XDG_CONFIG_HOME` is ignored). `Exec` and `TryExec` name
  `$APPIMAGE` only when this process runs from that AppImage, else the
  executable, escaped per the Desktop Entry spec; a path with a control
  character is refused.
- **macOS** is not shipped and uses `openAtLogin` as Electron offers it.

**Timely never re-enables what the system turned off.** At boot it only adds
a missing entry or repairs one that points elsewhere. An entry turned off in
Windows' Startup apps (the launch item's `enabled: false`) or by the desktop
(`Hidden=true`, `X-GNOME-Autostart-enabled=false`) stays off, and Settings
shows the switch Off with a hint that says who turned it off. Only the
person's own switch writes the entry back on. Electron's `enabled` defaults
to true, so passing it at every boot would silently undo a Task Manager
choice.

**A login start is hidden.** It passes `--hidden`: no boot window and no main
window, only the tray. A boot error still shows the boot window, and a hidden
start before first-run setup is finished shows the window as usual, so a
failure or an unfinished setup is never hidden. A second instance started
with `--hidden` does nothing.

**Only installed builds register.** Login items work in packaged builds, or
with `TIMELY_DEV_LOGIN_ITEM=1` for a smoke test; otherwise the row is shown
disabled with "Works in the installed app." A dev run must never register
`node_modules/electron` to start at login.

**Uninstall and updates keep the entry honest.** The NSIS uninstaller removes
the Run and StartupApproved values unless it is running for an update. When
an AppImage update renames the file on quit (`appimage-filename-updated`),
the autostart entry is rewritten with the new path at once, because the next
sign-in would otherwise launch a deleted file.

**Upgraders get one notice, in the app.** "Timely now starts when you sign in
so your bots keep watching. Turn off in Settings", with a Settings action,
shown for 20 seconds. It waits for a visible, focused window, and
`dismissLoginNotice` clears the flag and answers `cleared: true` to exactly
one caller, which alone shows it. It is never used up in a window nobody saw,
and shows once across windows and reloads. The switch itself lives in
Settings › Notifications, in a desktop-only "This computer" card.

## Instant push

**Bot alerts have their own Android channel.** Bot pushes go out on the
channel `bots` ("Bot alerts" on the phone), so people can give them their own
sound. They carry `botAlert`, `resume`, `alertId` and `checkId`, and a
resumable paused alert uses the category `timely_bot_paused`, so Resume works
from a push as it does from polling. The Phone switch, Urgent, quiet hours
and the digest rules are unchanged.

**The Expo address can be changed, but only to https.** The base URL is
`TIMELY_EXPO_PUSH_URL` (default Expo's), with an optional
`TIMELY_EXPO_ACCESS_TOKEN` sent as a Bearer token. A value that is not
`https://` is refused unless its host is loopback, and the default is used.
The desktop passes every `TIMELY_*` variable to the API, so a stray `http://`
must never carry alert text and tokens. Sends go in chunks of 100; only a
failure on the first chunk is an error, so a retry never re-sends chunks that
already went out.

**Dead tokens are pruned from receipts.** Expo reports most dead tokens only
in receipts. Each send with ok tickets queues one `push_receipts` job 15
minutes later, on a lane of its own so slow receipt calls never delay the
sweep. Its payload maps ticket ids to device ids with the send time, and holds
no tokens. `DeviceNotRegistered`, in a ticket or a receipt, deletes that one
device only if it has not been registered again since the send, by anyone.

**"Hide alert text in push" is a setting of its own.** `hidePushText`
(default off) is set only by `PUT /notifications/settings/push-text` with one
`jsonb_set`; saving the rest of the notification settings keeps the stored
value in the same UPDATE. The web and phone forms send their whole draft, so
neither a stale draft nor a concurrent save can undo the switch.

**Hidden means a fixed list.** With it on, every Bot push says "Timely" and
"A bot has news", and its data is built from scratch with only
`notificationId`, `category`, `botId`, `alertId`, `checkId`, `botAlert`,
`resume`, `entityType` and `entityId`. No page URL or future data field can
leak. A digest's "From your bots:" section is cut and replaced with "Your bots
have news." Reminders and other categories are unchanged for now.

**A push device belongs to a sign-in.** `push_devices.session_id` references
`user_sessions(id) ON DELETE CASCADE` and is set from the request's session
when the phone registers. Pushes go only to devices whose session still
exists and has not expired. Logout, signing a lost phone out from the Sessions
list, "sign out others" and expiry all stop its pushes, with no change to the
auth code. A device registered before this has no session and gets nothing
until the phone registers again, which it does at every start.

**The phone side is gated.** With no EAS project id the phone never asks for
an Expo token and keeps polling every 15 minutes; Settings › Notifications
says why in plain words. The maintainer steps are in `docs/mobile/push.md`.

## Why no wake endpoint

The brief offered two ways to notice a wake: Electron's `powerMonitor`
telling the API, or the scheduler noticing a big gap. Timely uses only the
second. The API process sleeps with the computer, so its first sweep after
waking always sees the gap, within one 10-second tick. That works the same for
a Docker or server install with no Electron at all, and needs no new route,
no shared secret between the desktop and the API, and no second code path
that could disagree with the first. The cost: if the job worker is held up
for over a minute by one long job, the next sweep counts as a wake, and Bots
more than 30 minutes late say "while this computer was asleep" when they were
only late. Receipts run on their own lane, so they never cause this.

## Considered Options

- **Replay every missed slot**: rejected; nine hourly checks of the same page
  a second apart read the same thing nine times and can raise nine alerts.
- **Catch up silently**: rejected; the owner's rule is that a Bot never
  pretends nothing happened, and a quiet nine-hour hole looks like a broken
  Bot.
- **A wake endpoint fed by `powerMonitor`**: rejected; see above.
- **Spread each batch over a fixed window**: rejected; batches of 200 stacked
  on each other's slots, and a fixed window crowds a large catch-up into it.
- **Keep the away time on the check job**: rejected; a job queued before the
  close, a retry or a shutdown release loses it, and only the batch being
  queued would be marked.
- **Re-apply the login item at every boot**: rejected; it re-enables what the
  person turned off in Task Manager or their desktop's startup settings.
- **Detect upgraders by version**: rejected; the missing `startAtLogin` key
  already says the install predates the feature.
- **An OS notification for the upgrade notice**: rejected; it can be used up
  while Timely sits hidden in the tray, and Windows toasts from Electron get
  no buttons.
- **Hide text by removing known fields**: rejected; a hidden push builds its
  data from a fixed list, so a field added later cannot leak.
- **Revoke the push token from the phone only**: rejected as the only
  safeguard; a lost or offline phone never sends the DELETE, so the server
  ties the device to its sign-in instead.

ADR numbering: 0021 to 0023 are on `feature/bots-adr`; if that branch has not
merged first, renumber this file at merge time.
