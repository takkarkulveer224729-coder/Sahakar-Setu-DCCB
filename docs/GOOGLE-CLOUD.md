# Move Coop Connect to Google Cloud (free server, same link)

After this, Coop Connect runs on Google's free server 24 hours a day. **Your office PC can be
switched off**, and your link **stays exactly the same**:

**https://complianceofficer.taile031e5.ts.net**

The link belongs to your Tailscale account and the machine name `complianceofficer`. The new
server joins the same Tailscale account with that same name, so your friends' bookmarks
keep working. All accounts, messages and shared files are moved across.

**Time needed:** about 30–40 minutes, once. People can't chat during the last ~10 minutes
(steps 4–6), so do it at a quiet time.

**You need:** a Google account, a debit/credit card for Google's sign-up, your Tailscale
login, and the latest `coop-connect.zip`.

---

## Step 1: Create a Google Cloud account

1. Open **https://console.cloud.google.com** and sign in with a Google account.
2. Accept the terms. Google asks for a **card** to confirm you are a real person.
   - New accounts also get free trial credit. The **Always Free** server below stays free after
     the trial ends, as long as you keep to the free limits.
3. When asked, create a **project** (any name, for example `coop-connect`).

## Step 2: Set a spending alert (recommended)

So you are told before anything costs money:

1. Menu ☰ → **Billing** → **Budgets & alerts** → **Create budget**.
2. Amount: **₹100** (or $1). Keep the email alerts ticked → **Finish**.

## Step 3: Create the free server

1. Menu ☰ → **Compute Engine** → **VM instances**. Click **Enable** if asked (takes a minute).
2. Click **Create instance** and set **exactly** these:

| Setting | Choose |
|---|---|
| Name | `coop-connect` |
| Region | **us-central1 (Iowa)**, **us-west1 (Oregon)** or **us-east1 (South Carolina)** (only these are free) |
| Machine type | Series **E2** → **e2-micro** |
| Boot disk → **Change** | Operating system **Debian**, version **Debian 12** (or newer), disk type **Standard persistent disk**, size **30 GB** |
| Firewall | Leave **HTTP/HTTPS unticked** (not needed; Tailscale handles the link) |

> ⚠️ The disk type must be **Standard persistent disk**. Google often pre-selects "Balanced",
> which is **not** free.

3. Click **Create**. The price shown on the right is Google's normal price. The Always Free
   allowance is taken off your bill afterwards.

> **About cost:** Google's free tier covers the e2-micro server, its internet address, the 30 GB
> standard disk and **1 GB of data sent to users per month**, so the expected cost is **₹0**.
> Only data above 1 GB a month is charged (roughly ₹10–12 per extra GB plus GST), which mainly
> happens if many photos, videos or large files are shared. Your spending alert from step 2 warns
> you. Check **Billing → Reports** after the first week. It should show ₹0.

## Step 4: On the old PC, pack your data and switch it off

On the current server PC (`complianceofficer`), in the `coop-connect` folder:

1. Double-click **`export-data.bat`**. It creates **`coop-data-backup.zip`** with all accounts,
   messages and files, and opens the folder showing it.
2. Double-click **`uninstall-autostart.bat`** → **Yes**, so the old PC stops serving the app.

## Step 5: Free up the name "complianceofficer" in Tailscale

1. Open **https://login.tailscale.com/admin/machines**.
2. Find the machine **complianceofficer** (your old PC) → **⋯** → **Remove** → confirm.

This frees the name so the new server can use it, which keeps the same link.

## Step 6: Install Coop Connect on the new server

1. In Google Cloud → **VM instances**, click **SSH** next to `coop-connect`. A black terminal
   window opens in your browser.
2. In that window, click **Upload file** (⬆ at the top) and upload **both**:
   - `coop-connect.zip`
   - `coop-data-backup.zip`
3. Paste this whole line and press **Enter**:

   ```
   unzip -qo coop-connect.zip && sudo bash coop-connect/scripts/install-linux.sh --import coop-data-backup.zip
   ```

4. Wait about 3–5 minutes while it installs. Then:
   - It shows a **Tailscale sign-in link**. Open it on your phone or PC and sign in with the
     **same Tailscale account** as before.
   - If it shows a link to **enable Funnel**, open it and click **Enable**.
5. At the end it shows:

   ```
   Coop Connect is online at:
      https://complianceofficer.taile031e5.ts.net
   This is the same link as before - nothing to change for users.
   ```

## Step 7: Test

On your phone, **turn Wi-Fi off**, open **Chrome**, and go to
**https://complianceofficer.taile031e5.ts.net**. Log in with your usual username and password.
Your chats and files are there. Now you can switch the office PC off.

The first time, allow up to 10 minutes for the secure certificate to be created.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| The end message says the name is still used by another machine | Do **step 5** (remove the old machine), then run `sudo tailscale set --hostname=complianceofficer` |
| "No data/db.json found" | You uploaded the wrong zip. Upload the `coop-data-backup.zip` from step 4 |
| "Coop Connect did not start" | Run `sudo journalctl -u coop-connect -n 50` and send a photo of the output |
| The link doesn't open after 10 minutes | Run `sudo tailscale funnel status` and send a photo of the output |

## Everyday use

Nothing to do: the server restarts Coop Connect by itself, even after Google maintenance.

**Updating to a new version:** open **SSH**, upload the new `coop-connect.zip`, then run:

```
unzip -qo coop-connect.zip && sudo bash coop-connect/scripts/install-linux.sh
```

(no `--import` this time, so your data stays as it is).

**Backup:** in SSH, run
`sudo tar czf coop-backup.tgz -C /var/lib coop-connect`, then click **Download file** (⬇ at the top)
and enter `/home/<your-name>/coop-backup.tgz` (the SSH window shows your name before `@`).

**Useful commands** (in SSH):

```
sudo systemctl status coop-connect     # is it running?
sudo journalctl -u coop-connect -f     # live log (Ctrl+C to stop)
sudo systemctl restart coop-connect    # restart the app
```
