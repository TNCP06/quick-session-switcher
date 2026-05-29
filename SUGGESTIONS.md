# Suggestions

Items found during development that are worth considering but not urgent.
Do not implement unless explicitly requested.

---

## Feature

### Domain alias yang bisa dikonfigurasi user
**Why:** `getExtraDomains()` di `background.js` sekarang hardcode hanya untuk Google/YouTube/OpenAI. User yang punya kebutuhan multi-subdomain lain (misal `app.company.com` + `auth.company.com`) tidak bisa menambah sendiri tanpa edit kode.
**Effort:** High — butuh settings UI di popup dan schema storage baru. Pertimbangkan dulu seberapa sering kasus ini terjadi.
