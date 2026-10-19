# Sahakar Setu Chat

A WhatsApp-style chat and file-sharing app that runs on your PC. One PC runs the
server; everyone on the same network (office LAN / Wi-Fi) chats from their browser.

## Features

- One-to-one chats and group chats
- Share photos, videos, audio, PDFs, Word/Excel and any other files (up to 100 MB each)
  — via the 📎 button, drag & drop onto the chat, or paste (Ctrl+V)
- Image viewer, inline video/audio players, file download cards
- Sent / delivered / read ticks (✓, ✓✓, blue ✓✓)
- Online status, "last seen", and "typing…" indicators
- Reply to a message (double-click it, or use the ▼ menu), copy, delete for everyone
- Emoji picker, clickable links, unread counters, desktop notifications with sound
- Search chats and people, profile "About" text
- Light and dark theme (follows Windows/macOS setting)
- Messages and files are saved on the server PC (`data/` and `uploads/` folders)

## Run it on Windows

1. Install **Node.js** (LTS) from <https://nodejs.org>.
2. Download this project and double-click **`start-chat.bat`**.
   The first run installs dependencies, then the chat opens at <http://localhost:3000>.

## Run it from a terminal (Windows, macOS, Linux)

```bash
npm install
npm start
```

Open <http://localhost:3000>. The terminal also prints addresses like
`http://192.168.1.25:3000` — open that on other PCs on the same network to chat
with them. (If Windows Firewall asks, allow Node.js on private networks.)

Type any name and password to sign up; use the same name and password later to log in.

## Settings

| Variable        | Default | Meaning                      |
| --------------- | ------- | ---------------------------- |
| `PORT`          | `3000`  | Port the server listens on   |
| `MAX_UPLOAD_MB` | `100`   | Largest file you can share   |

Example: `set PORT=8080 && npm start` (Windows) or `PORT=8080 npm start`.

## Backing up

Copy the `data/` (accounts and messages) and `uploads/` (shared files) folders.
