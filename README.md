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

### Option A: Public link from your PC (free, quickest)

Double-click **`start-online.bat`** (Windows) or run `./start-online.sh` (macOS/Linux).

- The first time on Windows, it installs Cloudflare Tunnel (`cloudflared`) for you. Then run it again.
- It prints a link like `https://blue-river-1234.trycloudflare.com`. Share it with anyone.
  It works over any network, with HTTPS.
- Keep the PC on and the window open while people chat.
- The link changes each time you restart it. For a permanent address, use Option B, or a
  [named Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
  with your own domain.

### Option B: Host it in the cloud (always on, permanent address)

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
