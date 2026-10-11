import { Download } from "lucide-react";
import Link from "next/link";
import { AUR_URL, LATEST_RELEASE_URL, TAILSCALE_URL } from "@/app/_components/site/links";
import type { HelpSection } from "../types";
import { Callout, Code, DownloadLink, Path, PhoneShots, Shot, Steps } from "../ui";

export const install: HelpSection = {
  id: "install",
  title: "Install",
  description: "Install Timely on Windows, Ubuntu, Arch Linux and Android, and keep it up to date.",
  icon: Download,
  articles: [
    {
      slug: "windows",
      title: "Install on Windows",
      summary: "Download the installer, get past SmartScreen, and start Timely for the first time.",
      keywords: ["windows", "exe", "installer", "smartscreen", "setup", "uninstall"],
      lead: (
        <>
          <p>
            Timely for Windows is a per-user installer for 64-bit Windows 10 and 11. It brings its own server and
            database, so there is nothing else to install.
          </p>
          <p>
            <DownloadLink href={LATEST_RELEASE_URL}>Latest release on GitHub</DownloadLink>
          </p>
        </>
      ),
      sections: [
        {
          id: "download",
          title: "Download and install",
          body: (
            <>
              <Steps>
                <p>
                  Open the <a href={LATEST_RELEASE_URL}>latest release</a> and, under <strong>Assets</strong>,
                  download <code>Timely-x.y.z-win-x64.exe</code>.
                </p>
                <p>
                  Run the file. The installer is not code-signed yet, so Windows may show{" "}
                  <em>Windows protected your PC</em>. Choose <strong>More info</strong>, then{" "}
                  <strong>Run anyway</strong>.
                </p>
                <p>
                  Pick a folder or keep the suggested one, and finish the installer. It installs for your user only and
                  does not ask for administrator rights.
                </p>
                <p>
                  Start <strong>Timely</strong> from the Start menu. The first launch creates the database and starts
                  the server, which takes a few seconds. Then <Link href="/help/start/first-week">create your
                  account</Link>.
                </p>
              </Steps>
              <Callout kind="warning">
                Don&apos;t run Timely as Administrator. Its database refuses to start with elevated rights, so Timely
                shows a message and quits.
              </Callout>
            </>
          ),
        },
        {
          id: "tray",
          title: "The tray icon",
          body: (
            <p>
              Closing the window hides Timely to the system tray; the server keeps running so your phone and reminders
              keep working. To stop everything, right-click the tray icon and choose <strong>Quit Timely</strong>.
            </p>
          ),
        },
        {
          id: "updates",
          title: "Updates",
          body: (
            <p>
              Installed copies update themselves from GitHub Releases. To check by hand, open{" "}
              <Path>Settings &gt; Server</Path> and choose <strong>Check for updates</strong>. Timely backs up the
              database before the first start of a new version. See{" "}
              <Link href="/help/install/updates-and-data">Updates, data and backups</Link>.
            </p>
          ),
        },
        {
          id: "uninstall",
          title: "Uninstall",
          body: (
            <p>
              Remove Timely from <Path>Windows Settings &gt; Apps &gt; Installed apps</Path>. Your data stays in{" "}
              <code>%APPDATA%\Timely</code>, so a reinstall picks up where you left off. Delete that folder too if you
              want to remove everything.
            </p>
          ),
        },
      ],
    },
    {
      slug: "ubuntu",
      title: "Install on Ubuntu",
      summary: "Run the AppImage on Ubuntu and other Debian-based distributions.",
      keywords: ["ubuntu", "linux", "debian", "mint", "appimage", "fuse", "libfuse2"],
      lead: (
        <>
          <p>
            On Ubuntu, Timely runs as an AppImage: one file that holds the app, its server and its database. These
            steps also work on Debian, Linux Mint and Pop!_OS.
          </p>
          <p>
            <DownloadLink href={LATEST_RELEASE_URL}>Latest release on GitHub</DownloadLink>
          </p>
        </>
      ),
      sections: [
        {
          id: "fuse",
          title: "Install FUSE",
          body: (
            <>
              <p>AppImages need FUSE 2. On Ubuntu 24.04 and newer:</p>
              <Code>sudo apt install libfuse2t64</Code>
              <p>On Ubuntu 22.04, Debian and older releases:</p>
              <Code>sudo apt install libfuse2</Code>
            </>
          ),
        },
        {
          id: "download",
          title: "Download and run",
          body: (
            <Steps>
              <p>
                Download <code>Timely-x.y.z-linux-x86_64.AppImage</code> from the{" "}
                <a href={LATEST_RELEASE_URL}>latest release</a>.
              </p>
              <div>
                <p>Move it somewhere permanent and make it executable:</p>
                <Code>{`mkdir -p ~/Applications
mv ~/Downloads/Timely-*.AppImage ~/Applications/
chmod +x ~/Applications/Timely-*.AppImage`}</Code>
              </div>
              <div>
                <p>Start it by double-clicking the file, or from a terminal:</p>
                <Code>~/Applications/Timely-*.AppImage</Code>
              </div>
              <p>
                The first launch creates the database and starts the server. Then{" "}
                <Link href="/help/start/first-week">create your account</Link>.
              </p>
            </Steps>
          ),
        },
        {
          id: "menu-entry",
          title: "Add it to the app menu (optional)",
          body: (
            <>
              <p>An AppImage doesn&apos;t add itself to the app menu. To add an entry, create a launcher file:</p>
              <Code>{`cat > ~/.local/share/applications/timely.desktop <<EOF
[Desktop Entry]
Name=Timely
Exec=$(ls ~/Applications/Timely-*.AppImage | tail -n1) %U
Type=Application
Categories=Office;
StartupWMClass=Timely
EOF`}</Code>
              <p>
                If you update by downloading a new AppImage by hand, run this again so the entry points at the new
                file.
              </p>
            </>
          ),
        },
        {
          id: "updates",
          title: "Updates",
          body: (
            <p>
              The AppImage updates itself from GitHub Releases. Check by hand in <Path>Settings &gt; Server</Path>.
              Your data lives in <code>~/.config/Timely</code>, not in the AppImage, so replacing the file never
              touches it.
            </p>
          ),
        },
        {
          id: "troubleshooting",
          title: "Troubleshooting",
          body: (
            <>
              <ul>
                <li>
                  <strong>Nothing happens, or an error about FUSE:</strong> install FUSE as above, or start it with{" "}
                  <code>--appimage-extract-and-run</code>.
                </li>
                <li>
                  <strong>It closes right away with a sandbox error in the terminal:</strong> newer Ubuntu releases
                  limit the sandbox that Electron apps use. Starting Timely with <code>--no-sandbox</code> works around
                  it, at the cost of that extra isolation.
                </li>
                <li>
                  <strong>It refuses to start as root:</strong> run it as your normal user. Its database won&apos;t
                  run as root.
                </li>
              </ul>
            </>
          ),
        },
      ],
    },
    {
      slug: "arch",
      title: "Install on Arch Linux",
      summary: "Install the timely-bin package from the AUR and update it with pacman.",
      keywords: ["arch", "aur", "pacman", "yay", "paru", "makepkg", "manjaro", "endeavouros", "timely-bin"],
      lead: (
        <>
          <p>
            On Arch Linux and its derivatives, install Timely from the AUR package <code>timely-bin</code>. It
            unpacks the official AppImage into <code>/opt/timely-bin</code>, adds a <code>timely</code> command and an
            app menu entry, and is updated by your package manager.
          </p>
          <p>
            <DownloadLink href={AUR_URL}>timely-bin on the AUR</DownloadLink>
          </p>
        </>
      ),
      sections: [
        {
          id: "aur-helper",
          title: "With an AUR helper",
          body: (
            <>
              <p>With yay:</p>
              <Code>yay -S timely-bin</Code>
              <p>Or with paru:</p>
              <Code>paru -S timely-bin</Code>
            </>
          ),
        },
        {
          id: "makepkg",
          title: "Without a helper",
          body: (
            <>
              <p>
                Build it yourself with <code>makepkg</code>. You need <code>base-devel</code> and <code>git</code>.
              </p>
              <Code>{`git clone https://aur.archlinux.org/timely-bin.git
cd timely-bin
makepkg -si`}</Code>
            </>
          ),
        },
        {
          id: "start",
          title: "Start Timely",
          body: (
            <p>
              Open <strong>Timely</strong> from your app menu, or run <code>timely</code>. The first launch creates the
              database in <code>~/.config/Timely</code>; then <Link href="/help/start/first-week">create your
              account</Link>.
            </p>
          ),
        },
        {
          id: "updates",
          title: "Updates",
          body: (
            <>
              <p>
                Update with your AUR helper (<code>yay -Syu</code>), or pull and run <code>makepkg -si</code> again.
                The in-app updater is off for this install; <Path>Settings &gt; Server</Path> says{" "}
                <em>Updated by your package manager</em>.
              </p>
              <p>
                If Timely is still running in the tray during an upgrade, it notices the new files and restarts into
                them the next time you open it. While the window is open, the tray menu offers{" "}
                <strong>Restart to finish updating</strong>.
              </p>
              <Callout kind="note">
                Upgrading from 0.3.0 or older needs one <strong>Quit Timely</strong> from the tray, because the running
                copy doesn&apos;t know how to restart itself yet. Later upgrades restart on their own.
              </Callout>
            </>
          ),
        },
      ],
    },
    {
      slug: "android",
      title: "Install on Android",
      summary: "Install the APK, pair it with your computer by QR code, and use it away from home.",
      keywords: ["android", "apk", "phone", "mobile", "pair", "qr", "tailscale", "unknown sources"],
      lead: (
        <>
          <p>
            The Android app talks to the Timely server on your computer. Install the desktop app first, then pair your
            phone with it.
          </p>
          <p>
            <DownloadLink href={LATEST_RELEASE_URL}>Latest release on GitHub</DownloadLink>
          </p>
        </>
      ),
      sections: [
        {
          id: "install-apk",
          title: "Install the APK",
          body: (
            <Steps>
              <p>
                On your phone, open the <a href={LATEST_RELEASE_URL}>latest release</a> and download{" "}
                <code>Timely-x.y.z-android-arm64.apk</code>.
              </p>
              <p>
                Open the downloaded file. Android asks you to allow installs from your browser or Files app the first
                time; allow it, go back, and choose <strong>Install</strong>.
              </p>
              <p>Open Timely and allow notifications, so reminders can reach you.</p>
            </Steps>
          ),
        },
        {
          id: "pair",
          title: "Pair with your computer",
          body: (
            <>
              <Steps>
                <p>
                  On your computer, open Timely and go to <Path>Settings &gt; Server</Path>. The{" "}
                  <strong>Pair your phone</strong> section shows a QR code.
                </p>
                <p>
                  On the phone, choose <strong>Scan QR code</strong> and point the camera at it. You can also type the
                  address shown under the code.
                </p>
                <p>Sign in with the same account you use on the computer.</p>
              </Steps>
              <Shot
                src="settings-server-pair"
                alt="Settings, Server tab on the desktop: a QR code to pair your phone, the address, and the Tailscale access switch."
                caption="Settings → Server on the desktop app."
              />
              <PhoneShots
                shots={[
                  { src: "phone-server", alt: "Phone screen: Connect to your Timely desktop, with Scan QR code and an address field." },
                  { src: "phone-home", alt: "Phone Home tab after signing in." },
                ]}
                caption="Connecting the phone, then the Home tab once you are signed in."
              />
            </>
          ),
        },
        {
          id: "away-from-home",
          title: "Use it away from home",
          body: (
            <>
              <p>
                By default the server only answers on your computer. To reach it from anywhere without opening it to
                the internet, use <a href={TAILSCALE_URL}>Tailscale</a>, a free private network between your own
                devices.
              </p>
              <Steps>
                <p>Install Tailscale on the computer and on the phone, and sign in to the same account on both.</p>
                <p>
                  In Timely on the computer, turn on <Path>Settings &gt; Server &gt; Tailscale access</Path>. The
                  server restarts for a moment and the QR code now includes the Tailscale address.
                </p>
                <p>Pair the phone again by scanning the new code.</p>
              </Steps>
              <Callout kind="tip">
                Traffic stays inside your Tailscale network. Nothing is exposed to your Wi-Fi or the internet.
              </Callout>
            </>
          ),
        },
        {
          id: "updates",
          title: "Updates",
          body: (
            <>
              <p>
                The phone app doesn&apos;t update itself. Download the new APK from the release and install it over the
                old one; you stay signed in.
              </p>
              <Callout kind="note">
                Current APKs are signed with a development key. If a future release switches to a release key, Android
                will ask you to uninstall the old app once. Your data lives on your computer, so nothing is lost; just
                pair and sign in again.
              </Callout>
            </>
          ),
        },
      ],
    },
    {
      slug: "updates-and-data",
      title: "Updates, data and backups",
      summary: "Where Timely keeps your data, how updates work, and the backups it makes for you.",
      keywords: ["update", "upgrade", "data folder", "backup", "restore", "appdata", "config"],
      lead: (
        <p>
          The desktop app keeps everything in one folder on your computer and makes a copy before every upgrade.
          Here is where things live and how to look after them.
        </p>
      ),
      sections: [
        {
          id: "data-folder",
          title: "Where your data lives",
          body: (
            <>
              <table>
                <tbody>
                  <tr>
                    <td>Windows</td>
                    <td>
                      <code>%APPDATA%\Timely</code>
                    </td>
                  </tr>
                  <tr>
                    <td>Linux (AppImage and AUR)</td>
                    <td>
                      <code>~/.config/Timely</code>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p>
                That folder holds the PostgreSQL database, encrypted account backups, chat images and logs.{" "}
                <Path>Settings &gt; Server</Path> shows it and has buttons to open the data folder and the logs.
              </p>
              <Shot
                src="settings-server"
                alt="Settings, Server tab: status of the database, server and app, the data folder, and a connection check."
              />
            </>
          ),
        },
        {
          id: "updates",
          title: "How updates work",
          body: (
            <ul>
              <li>
                <strong>Windows and the AppImage</strong> check GitHub Releases and update themselves. Use{" "}
                <strong>Check for updates</strong> in <Path>Settings &gt; Server</Path> to check now.
              </li>
              <li>
                <strong>Arch (AUR)</strong> is updated by pacman or your AUR helper. See{" "}
                <Link href="/help/install/arch">Install on Arch Linux</Link>.
              </li>
              <li>
                <strong>Android</strong> is updated by installing the new APK. See{" "}
                <Link href="/help/install/android">Install on Android</Link>.
              </li>
            </ul>
          ),
        },
        {
          id: "backups",
          title: "Backups Timely makes",
          body: (
            <ul>
              <li>
                <strong>Before an upgrade:</strong> the first start of a new version copies the database folder first.
                The last three copies are kept.
              </li>
              <li>
                <strong>Back up now</strong> in <Path>Settings &gt; Server</Path> makes the same copy on demand; the
                database pauses for a moment.
              </li>
              <li>
                <strong>Encrypted account backups</strong> on a schedule, plus a full JSON export, live in{" "}
                <Path>Settings &gt; Data &amp; privacy</Path>. See{" "}
                <Link href="/help/account/backups">Export, backup and restore</Link>.
              </li>
            </ul>
          ),
        },
      ],
    },
  ],
};
