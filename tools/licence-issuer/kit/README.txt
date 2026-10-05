VictorFlow licence issuer - offline kit (BluxTech only)
======================================================

This folder signs VictorFlow licences. It holds no secret itself: the private key and the ledger live in a
separate folder you choose (see 2). Use it ONLY on BluxTech's offline Windows PC. Never install it on a shop's
server, never copy it to a shared or cloud folder.

What is in this folder

  node.exe              Node.js 22.23.2 for Windows x64 (official build, checksum-verified when the kit was made)
  cli.mjs               the licence issuer, one file, everything bundled (no node_modules, no internet)
  licence-issuer.cmd    shortcut: "licence-issuer <command> ..." instead of "node.exe cli.mjs <command> ..."
  NODE-LICENSE.txt      Node.js licence
  KIT-INFO.txt          when and from which commit the kit was made, and the SHA-256 of node.exe and cli.mjs
  README.txt            this file

Check the copy before first use (Command Prompt in this folder):
  certutil -hashfile cli.mjs SHA256
  certutil -hashfile node.exe SHA256
Both must match KIT-INFO.txt.


1. Install on the offline PC
----------------------------

1. Copy this whole folder from the USB stick to the offline PC, for example C:\BluxTech\licence-issuer-kit
   (the folder can live anywhere; it can be replaced by a newer kit at any time).
2. Open a Command Prompt in that folder (File Explorer: click the address bar, type cmd, press Enter).
3. Check it runs:
     licence-issuer help

Nothing is installed, nothing is written to the registry. Windows may warn that node.exe is from the internet
(SmartScreen): it is Node.js's own signed program.


2. Where the private key and the ledger live
-------------------------------------------

Keep them in ONE data folder, separate from this kit, on the offline PC's own disk. Suggested:

  C:\BluxTech\vf-licensing\
      keys\licence-private-key.pem   THE SECRET. Whoever has it can make licences for any shop.
      keys\licence-public-key.pem    not secret: it goes into VictorFlow (the developer builds it in)
      ledger.json                    every activation code: shop, terms, licences issued, transfers
      licences\                      the licences issued (.vfl and .txt), one pair per licence

Rules:
  - The issuer refuses to put the key or the ledger inside a repository folder (any folder with a .git or a
    VictorFlow checkout above it).
  - Never put the data folder on the USB stick you use to carry request codes and licences.
  - Never email, upload, paste or photograph the private key.


3. Create the key pair (ONCE)
-----------------------------

  licence-issuer keygen --out C:\BluxTech\vf-licensing\keys

It writes licence-private-key.pem and licence-public-key.pem, and never overwrites an existing key. It prints one
line starting with MCowBQYDK2VwAyEA: give that line (the PUBLIC key) to the developer, who puts it into
packages/crypto/src/licence-public-key.ts. Until then VictorFlow refuses to build a release.

Back up the keys folder right away (see 8).


4. New activation codes for a shop
----------------------------------

  licence-issuer codes --ledger C:\BluxTech\vf-licensing\ledger.json --shop "Imprimerie El Djazair"

Prints one code, VF-XXXX-XXXX-XXXX, recorded as unused for that shop. Options:
  --count 3        several codes at once
  --transfers 2    free moves to a new server for this code (default 2)

Give the code to the shop with its copy of VictorFlow. Each code is single use.


5. Issue a licence (the shop's first activation)
------------------------------------------------

On the shop's server, the first company PC shows "Set up VictorFlow": the shop types the code, gets a REQUEST
CODE (VFR1-XXXXX-XXXXX-...) and sends it to you, for example by WhatsApp. Bring it to the offline PC (type it,
or a text file on the transfer USB stick), then:

  licence-issuer issue --key C:\BluxTech\vf-licensing\keys\licence-private-key.pem ^
    --ledger C:\BluxTech\vf-licensing\ledger.json ^
    --request VFR1-XXXXX-XXXXX-... ^
    --modules crm,sales,production,finance,inventory,workforce,audit ^
    --desktop-seats 3 --mobile-users 5 --updates-until 2027-10-05

  (^ continues a command on the next line in Command Prompt. Spaces, dashes and lower case in the request code
   are fine; a mistyped request code is refused, never signed.)

  --modules          what the shop bought: crm, sales, production, finance, inventory, workforce, audit
  --desktop-seats    company PCs signed in at the same time (at least 1)
  --mobile-users     people signed in on the mobile app (0 or more)
  --updates-until    YYYY-MM-DD: the licence covers every VictorFlow version released up to this date, for life;
                     a newer version runs read-only on it (renew the maintenance plan = issue a new licence
                     with a later date, see --reissue)
  --edition          display name, default "Standard"
  --out              where the files go (default: a "licences" folder next to the ledger)

It writes <licence id>.vfl and <licence id>.txt (the same licence) and prints it. Send the shop the .txt text by
WhatsApp (they paste it) or the .vfl file (they open it): copy only those files to the transfer USB stick.

Same server again (the shop lost the file, bought more seats or modules, renewed its updates):

  licence-issuer issue --key ... --ledger ... --request <its request code> --reissue [--desktop-seats 5 ...]

Terms not given again stay as they were.


6. Transfer to a new server (new computer, new disk, Windows reinstalled)
--------------------------------------------------------------------------

The shop installs VictorFlow Server on the new computer, opens Licence (or the setup screen), types its SAME
activation code and sends you the new request code:

  licence-issuer transfer --key C:\BluxTech\vf-licensing\keys\licence-private-key.pem ^
    --ledger C:\BluxTech\vf-licensing\ledger.json --request VFR1-...

The new licence keeps the same terms (add --modules, --desktop-seats ... to change them). Each code has a number
of free transfers (default 2); after that the issuer refuses unless you add --force (recorded in the ledger).
The old server's licence cannot be switched off from here: it keeps working there.


7. Inspect a licence
--------------------

  licence-issuer inspect C:\BluxTech\vf-licensing\licences\LIC-20261005-XXXXXX.vfl ^
    --public-key C:\BluxTech\vf-licensing\keys\licence-public-key.pem

Shows what the licence says (shop, server, seats, modules, updates-until) and whether its signature is VALID.
Use it on a licence a shop sends back to support, or to check a backup (see 8).


8. Backups
----------

What to back up: the whole data folder (C:\BluxTech\vf-licensing\): keys, ledger.json and licences\.

  - Right after keygen: copy the keys folder to TWO encrypted USB sticks (BitLocker To Go: right-click the drive
    > Turn on BitLocker), kept in two different places (for example the office safe and the owner's home).
  - After every session that issued codes or licences: copy the whole data folder to both sticks again (the
    ledger changes every time).
  - Check a backup: run "inspect" on a licence with the public key FROM the backup (signature: VALID), and compare
      certutil -hashfile <backup>\keys\licence-private-key.pem SHA256
    with the same command on the original.
  - Never back up to a cloud drive, an email, a phone, the code repository or a shop's server.

Restore: copy the data folder from a backup to the offline PC and keep using the same paths.

If the PRIVATE KEY is lost (no backup): licences already issued keep working, but no new licence can be signed for
the versions that carry this key. A new key pair is needed (keygen into a new folder), a new VictorFlow release with
the new public key, and a new licence for every shop on that release.

If the PRIVATE KEY is stolen or copied: anyone can make licences. Same as above, urgently: new key pair, new release,
new licences for every shop.

If the LEDGER is lost: licences keep working, but the record of which codes were used, for which server, with which
terms and transfers is gone. Restore it from the latest backup; licences issued since then can be read back with
"inspect" on their .vfl files.


9. When something is refused
----------------------------

Errors start with "licence-issuer:" and say what to do (exit code 2). A refused command writes nothing: no file,
no change to the ledger. Run "licence-issuer help" for every option.
