# Repair your Coop Connect link (same link, your own PC)

Your link does not change:

**https://complianceofficer.taile031e5.ts.net**

The app on your PC is fine — only the public link needs repairing. Do this on the
**server PC** (the one named `complianceofficer`). It takes about 10 minutes, mostly waiting.

---

## Step 1 — Run the repair tool

1. Make sure you have the latest **`coop-connect.zip`** unzipped into your `coop-connect` folder.
2. In that folder, double-click **`check-online.bat`**.
3. Click **Yes** when Windows asks for permission.

It checks five things and fixes what it can. Each line shows **[OK]** (green), **[FIX]**
(it fixed it), or **[X]** (red — needs you). Follow any yellow **→** step it prints.

The most common red line is the **https certificate**. If it says *"Enable HTTPS"*, do Step 2.

---

## Step 2 — Turn on HTTPS in Tailscale (only if the tool asks)

1. Open **https://login.tailscale.com/admin/dns** and sign in (same Tailscale account as before).
2. Scroll to **HTTPS Certificates**.
3. If there is an **Enable HTTPS** button, click it. (If it's already on, nothing to do.)
4. Go back and run **`check-online.bat`** again.

---

## Step 3 — Wait, then test

The very first time, Tailscale needs about **10 minutes** to create the certificate and
publish the link. After that:

1. On your phone, **turn Wi-Fi OFF** (use mobile data).
2. Open **Google Chrome**.
3. Go to **https://complianceofficer.taile031e5.ts.net** and log in.

If it opens — done. Keep the PC on and connected.

---

## If it still won't open

Run **`check-online.bat`** again and look at which line is red:

| Red line | What to do |
| --- | --- |
| Coop Connect not running | Double-click `start-coop-connect.bat`, then run the tool again |
| Tailscale not connected | Click the Tailscale icon near the clock, **Sign in** (same account), run the tool again |
| https certificate failed | Do **Step 2** above (Enable HTTPS), then run the tool again |
| Funnel could not turn on | Open the link the tool prints, click **Enable**, run the tool again |
| Everything green, but phone still fails | It's the phone's network: use **mobile data**, **Chrome**, and turn **Private DNS** and any **VPN/ad-blocker** OFF |

**Still stuck?** Open `coop-connect\logs\check-online.txt` (the tool saves its report there) and
send it, or send a photo of the black window, and ask for help.

---

## Keep it working after a restart

So you never have to repair it again, double-click **`install-autostart.bat`** once and
click **Yes**. It makes Coop Connect and the link start by themselves every time the PC
turns on. Answer **Y** when it asks to keep the PC awake while plugged in.

The PC must stay **on and connected to the internet** for people to use the chat.
