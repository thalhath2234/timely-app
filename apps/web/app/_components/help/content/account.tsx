import { Settings } from "lucide-react";
import Link from "next/link";
import type { HelpSection } from "../types";
import { Callout, Code, Path, Shot } from "../ui";

export const account: HelpSection = {
  id: "account",
  title: "Account and settings",
  description: "Your account and devices, appearance, backups, and the desktop server.",
  icon: Settings,
  articles: [
    {
      slug: "settings",
      title: "Account, devices and appearance",
      summary: "Change your name, email and password, sign out other devices, and pick a theme.",
      keywords: ["account", "password", "email", "devices", "sessions", "logout", "theme", "dark mode", "accent", "sidebar"],
      lead: (
        <p>
          Everything about your account lives in <strong>Settings</strong>, the gear at the bottom of the sidebar.
        </p>
      ),
      sections: [
        {
          id: "account",
          title: "Account and devices",
          body: (
            <>
              <p>
                <Path>Settings &gt; Account</Path> changes your name, email and password (you need the current one).
                Below it, <strong>Devices</strong> lists every browser, desktop app and phone signed in to your account;
                sign out any of them from there.
              </p>
              <Callout kind="warning">
                Timely sends no email, so there is no &ldquo;forgot password&rdquo; link. Keep your password somewhere
                safe. If you run Timely from source, an administrator can set a new one:
              </Callout>
              <Code>make reset-password EMAIL=you@example.com PASSWORD=new-password</Code>
            </>
          ),
        },
        {
          id: "appearance",
          title: "Appearance",
          body: (
            <>
              <p>
                <Path>Settings &gt; Appearance</Path> picks System, Light or Dark, an accent colour from the presets or
                your own, Reduce motion, and an auto-hiding sidebar that appears when the pointer reaches the left
                edge.
              </p>
              <Shot
                src="settings-appearance"
                alt="Settings, Appearance tab: colour mode set to Dark, accent colour swatches, Reduce motion and auto-hide sidebar options."
              />
            </>
          ),
        },
        {
          id: "notifications",
          title: "Notifications",
          body: (
            <>
              <p>
                <Path>Settings &gt; Notifications</Path> chooses which alerts you get, quiet hours, and digest times.
                See <Link href="/help/plan/reminders">Reminders and notifications</Link>.
              </p>
              <Shot src="settings-notifications" alt="Settings, Notifications tab with categories, quiet hours and digest times." />
            </>
          ),
        },
      ],
    },
    {
      slug: "backups",
      title: "Export, backup and restore",
      summary: "Download your data, schedule encrypted backups, and restore from one.",
      keywords: ["backup", "export", "restore", "json", "csv", "ics", "data", "privacy", "encrypted"],
      lead: (
        <p>
          <Path>Settings &gt; Data &amp; privacy</Path> is where your data goes in and out. On the desktop app, see
          also <Link href="/help/install/updates-and-data">Updates, data and backups</Link> for the copies Timely
          makes of the whole database.
        </p>
      ),
      sections: [
        {
          id: "export",
          title: "Export",
          body: (
            <>
              <ul>
                <li>
                  <strong>Full JSON backup</strong>: everything in your account, ready to restore.
                </li>
                <li>
                  <strong>Tasks CSV</strong>: your tasks for a spreadsheet.
                </li>
                <li>
                  <strong>Calendar ICS</strong>: your calendar for another calendar app.
                </li>
              </ul>
              <p>Single docs export as Markdown from their header, and sheet tabs as CSV.</p>
              <Shot
                src="settings-data"
                alt="Settings, Data and privacy tab: Full JSON backup, Tasks CSV and Calendar ICS buttons, encrypted server backups and Restore."
              />
            </>
          ),
        },
        {
          id: "encrypted",
          title: "Encrypted backups",
          body: (
            <p>
              Turn on scheduled backups and choose how often they run and how many to keep (up to 30).{" "}
              <strong>Create now</strong> makes one immediately. Backups are encrypted and stored by the server; download
              or delete them from the list.
            </p>
          ),
        },
        {
          id: "restore",
          title: "Restore",
          body: (
            <Callout kind="warning">
              <strong>Choose backup to restore</strong> replaces everything in your account with the backup. Your
              sign-in, devices and API keys are kept. Export a fresh backup first if you might want today&apos;s data
              back.
            </Callout>
          ),
        },
      ],
    },
    {
      slug: "server",
      title: "Server and accounts",
      summary: "The desktop app's server: status, addresses, phone pairing, new accounts and maintenance.",
      keywords: ["server", "desktop", "tailscale", "allow new accounts", "registration", "sign up", "logs", "restart", "status"],
      lead: (
        <p>
          The desktop app runs its own Timely server and database. <Path>Settings &gt; Server</Path>, shown only in
          the desktop app, is where you look after them.
        </p>
      ),
      sections: [
        {
          id: "status",
          title: "Status and addresses",
          body: (
            <>
              <p>
                The top of the page shows whether the database, server and app are running, the data folder, and a
                connection check that asks the server the same way your phone would. <strong>Addresses</strong> lists
                where the server can be reached: this computer, and your Tailscale address when Tailscale access is on.
              </p>
              <Shot
                src="settings-server"
                alt="Settings, Server tab: Database, Server and App all running, the data folder, and a connection check marked Reachable."
              />
            </>
          ),
        },
        {
          id: "pairing-and-access",
          title: "Pairing and access",
          body: (
            <ul>
              <li>
                <strong>Pair your phone</strong> shows the QR code the Android app scans. See{" "}
                <Link href="/help/install/android">Install on Android</Link>.
              </li>
              <li>
                <strong>Tailscale access</strong> lets your own devices on your Tailscale network reach the server.
                Nothing is opened to the internet.
              </li>
              <li>
                <strong>Allow new accounts</strong> lets someone else register on this computer. Only the first account
                can sign up while it is off; turn it off again once everyone has an account.
              </li>
            </ul>
          ),
        },
        {
          id: "maintenance",
          title: "Maintenance",
          body: (
            <p>
              <strong>Back up now</strong> copies the whole database. <strong>Open data folder</strong> and{" "}
              <strong>Open logs</strong> show the files, and <strong>Restart server</strong> restarts it if something
              looks stuck. <strong>Updates</strong> shows your version and checks for a new one (on Arch, your package
              manager handles that).
            </p>
          ),
        },
      ],
    },
  ],
};
