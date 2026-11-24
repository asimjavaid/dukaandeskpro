# DukaanDesk Pro — owner guide (licences)

All of this runs on **your own Windows PC** (`C:\Users\asimj\dukaandesk`). Never on a shop PC.

## 1. Create your production key (once)
The key now in the code is a TEST key and the installer build refuses it.
```powershell
cd C:\Users\asimj\dukaandesk
# first copy the latest code from the dev box to this PC
pnpm install        # adds @electron/fuses (new build tool)
node tools\keygen\keygen.mjs init --force
```
This makes `C:\Users\asimj\.dukaandeskprokeys\private.pem` (secret) and `public.pem`, and writes the public key
into `packages\license\src\public-key.js`. Commit that file (public key only — never commit `private.pem`).

## 2. Back up the key folder (today)
Copy `C:\Users\asimj\.dukaandeskprokeys` to:
1. USB stick 1 (keep at home)
2. USB stick 2 (keep somewhere else)
3. Encrypted cloud: put the folder in a 7-Zip archive with AES-256 + a strong password
   (`7z a -p -mhe=on dd-keys.7z .dukaandeskprokeys`), upload to Google Drive. Keep the password in your password manager.
Lose it = you cannot make keys for installers you already sold. Leak it = anyone can make keys.
If it leaks: run `init --force` again, rebuild, and re-issue keys to your paying shops.

## 3. Build the installer
```powershell
pnpm package:win
```
Output: `dist-desktop\DukaanDesk Pro-Setup-<version>.exe`. It stamps today's date as the build date and signs the
file manifest with your key. The installer shows the licence agreement (EULA) first.
With a code-signing certificate later: set `CSC_LINK`, `CSC_KEY_PASSWORD`, `DD_SIGN=1` before building.

## 4. Issue a key by WhatsApp
1. Shop sends a photo/text of the **Machine Code** (Settings › Account › Licence › Open licence › Copy), e.g. `WP9E-F1N2-81K2-QNGE`.
2. After payment:
   ```powershell
   node tools\keygen\keygen.mjs sign --machine WP9E-F1N2-81K2-QNGE --shop "Madina Kiryana Store" --updates-months 12
   ```
3. Send the whole `DD2.…` line back on WhatsApp. They paste it → **Enter key**. Done; works offline forever.

Check what you issued: `node tools\keygen\keygen.mjs list` (or `--machine CODE`).

## 5. Trial extension (+7 days, once)
```powershell
node tools\keygen\keygen.mjs extend --machine WP9E-F1N2-81K2-QNGE --days 7
```
Works once on that PC, must be entered within 14 days. Paste in the same key box.

## 6. New PC (transfer)
Only after the shop says the old PC is gone/broken (the old PC can't be switched off remotely).
```powershell
node tools\keygen\keygen.mjs transfer --from OLD-CODE --machine NEW-CODE --shop "Madina Kiryana Store"
```
It warns if that shop already moved before — your re-issue limit decides what to do.

## 7. Renewal (Care / updates)
Licences are perpetual; updates are covered until the **updates-until** date. A shop that installs a newer
version after that date still works normally but sees "Updates ended · this version needs renewal". After the
Care payment:
```powershell
node tools\keygen\keygen.mjs renew --machine WP9E-F1N2-81K2-QNGE --shop "Madina Kiryana Store" --updates-months 12
```

---

## For the customer (copy-paste on WhatsApp)

**Trial:** DukaanDesk Pro is free for 14 days (or 200 hours of use). After that it becomes read-only: your sales,
reports and backups stay safe and you can still view and export them. To keep selling, buy a licence.

**To activate:**
1. Open DukaanDesk Pro → Settings → Account → Licence → **Open licence**.
2. Tap **Copy** next to the Machine Code and send it to me on WhatsApp.
3. I will send you a key starting with `DD2.` Paste it in the box and press **Enter key**.

**Licence terms:** one shop, one computer. Your data belongs to you. The licence never expires; free updates
until the date shown in the Licence screen. New computer? Send me the new Machine Code.

**"Computer date looks wrong":** set the correct date and time in Windows, then reopen DukaanDesk Pro.
