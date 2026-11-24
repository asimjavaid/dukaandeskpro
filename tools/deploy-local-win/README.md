# Lite local test deploy kit (Windows, per user)
Run on Asim's PC from this folder, not as admin:

    powershell -ExecutionPolicy Bypass -File .\deploy-lite.ps1            # demo shop
    powershell -ExecutionPolicy Bypass -File .\deploy-lite.ps1 -Data p1   # import a COPY of the P1 database

Needs: Node 20, internet (PostgreSQL 17.11-5 zip from get.enterprisedb.com, ~380 MB, SHA-256 checked).
Makes: `%USERPROFILE%\dukaandeskpro` (code + launchers), `%USERPROFILE%\dukaandeskpro-data` (PG 5443, logs),
`%USERPROFILE%\TEST-GUIDE-LITE.md`. Checks P1 files/ports before and after (deploy-log.txt). No service, no firewall, no admin.
`dukaandeskpro-src.zip` = `git archive` of the Lite repo (made by `make-kit.sh`).
