# Coop Connect

A WhatsApp-style chat and file-sharing app for your co-op. It runs on a PC or a
cloud server, and people use it from any browser on a PC, laptop or phone, on any
network: office LAN, home Wi-Fi or mobile data.

## Features

- **Accounts:** sign up with full name, username and password; log in with username and password
  - Usernames are unique (3–20 letters, numbers, `.` or `_`), and passwords are stored hashed (scrypt)
  - You stay logged in for 30 days. You can change your password from your profile, which logs out your other devices
  - Repeated wrong passwords are blocked for 15 minutes
- **Chats:** one-to-one chats and group chats
- **Sharing:** photos, videos, audio, PDFs, Word/Excel and any other file, up to 100 MB each
  - Send them with the 📎 button, drag & drop or paste (Ctrl+V)
  - A shared file can only be opened by people in the chat it was sent to
- **Status:** sent / delivered / read ticks, online and "last seen", and "typing…"
- **Messages:** reply, copy and delete for everyone, plus an emoji picker, clickable links, unread counts, search and desktop notifications
- **Look:** light and dark theme, and a layout that also works on phones

## 1. Try it on one PC or office network

1. Install **Node.js** (LTS) from <https://nodejs.org>.
2. Double-click **`start-coop-connect.bat`** (Windows), or run `npm install` and then `npm start`.
3. Open <http://localhost:3000>. Other PCs on the **same** network can open the
   `http://192.168.x.x:3000` address shown in the window.

## 2. Use it from anywhere (different networks)

People on other networks can't reach `localhost` or `192.168.x.x`. Pick one of these:

### Option A: Permanent link from your PC (free, recommended)

Double-click **`start-online.bat`** (Windows) or run `./start-online.sh` (macOS/Linux).
It uses [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) to give your PC a public
HTTPS address that **never changes**, like `https://coop-connect.tail1234.ts.net`.

The first time only:

1. Click **Yes** when Windows asks for administrator permission.
2. Tailscale is installed for you. Sign in in the browser window that opens, with any
   Google, Microsoft, Apple or GitHub account. It's free.
3. If Tailscale shows a link to **enable Funnel**, open it and click **Enable**.
4. The window prints your permanent link. Share it with everyone.

After that, just double-click `start-online.bat` whenever you start the PC, and the same
link works again. Keep the PC on and the *Coop Connect server* window open while people chat.

**Nicer link name:** the address is `https://<pc-name>.<tailnet-name>.ts.net`. In the
[Tailscale admin console](https://login.tailscale.com/admin/machines), rename the machine
to e.g. `coop-connect`. You can also pick a friendlier tailnet name under **DNS**. Do
this once, before you share the link.

**Turn the public link off:** run `tailscale funnel reset` in an administrator window.

**Just a quick test?** `start-quick-link.bat` (or `./start-quick-link.sh`) gives a
temporary `trycloudflare.com` link with no sign-in, but it changes on every start.

**Your own domain** (like `chat.yourcoop.in`): use a
[named Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/)
pointing at `http://localhost:3000`.

### Option B: Host it in the cloud (always on, permanent address)

Use this if the PC can't stay on. The address is fixed too.

**Render (easiest):**

1. Push this repository to GitHub.
2. On <https://render.com>, choose **New → Blueprint** and pick the repo.
   `render.yaml` sets everything up, including a disk that keeps your data.
3. Share the `https://coop-connect-xxxx.onrender.com` address.

The disk needs Render's paid *Starter* plan. On the free plan the app runs, but
messages and files are wiped whenever it restarts.

**Any server with Docker:**

```bash
docker build -t coop-connect .
docker run -d -p 3000:3000 -v coop-data:/data -e TRUST_PROXY=1 --restart unless-stopped coop-connect
```

Put it behind HTTPS (for example Caddy, Nginx or Cloudflare) before sharing the address.

## Settings

| Variable        | Default                          | Meaning                                          |
| --------------- | -------------------------------- | ------------------------------------------------ |
| `PORT`          | `3000`                           | Port the server listens on                       |
| `MAX_UPLOAD_MB` | `100`                            | Largest file you can share                       |
| `DATA_DIR`      | `./data`                         | Where accounts and messages are saved            |
| `UPLOAD_DIR`    | `./uploads`                      | Where shared files are saved                     |
| `TRUST_PROXY`   | `loopback, linklocal, uniquelocal` | Proxies to trust for HTTPS/IP (use `1` behind one proxy) |

## Backing up

Copy the data folder (`data/`, holding accounts and messages) and the uploads folder
(`uploads/`, holding shared files). For Docker, back up the `/data` volume.
