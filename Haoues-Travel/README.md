# Abu Ilyas Umrah — أبو إلياس للعمرة

Static RTL Arabic website for the Abu Ilyas Umrah reception, guidance and
airport-services platform. The
frontend is plain HTML/CSS/JS and is served from Vercel; a thin set of Vercel
serverless functions under `api/` proxy signed requests to a Google Apps Script
backend (`Code.gs`) that reads and writes a Google Sheet.

## Architecture

```
Browser (index.html + assets/js/script.js)
         │
         ▼
 Vercel serverless functions (api/*.js)
   - proxy.js      : main gateway (GET/POST → Google Apps Script)
   - auth.js       : admin login
   - upload.js     : image upload pass-through
   - register.js   : booking submission
   - update.js     : booking status updates
   - get-registrations.js : booking list
         │
         ▼
 Google Apps Script Web App (Code.gs)
         │
         ▼
 Google Sheets (OFFERS / BOOKINGS / ADS) + Google Drive (images)
```

## Local development

This project has no build step. To preview locally:

```bash
# From the `Haoues-Travel/` subfolder
python3 -m http.server 8000
# then open http://localhost:8000
```

The API routes only run on Vercel; local booking submissions will hit the
same production endpoints unless you point them elsewhere.

## Required environment variables

Configure these in **Vercel → Settings → Environment Variables** for *all*
environments (Production, Preview, Development):

| Name | Purpose |
| ---- | ------- |
| `GOOGLE_SHEETS_URL` | Web-app URL of the deployed Google Apps Script (e.g. `https://script.google.com/macros/s/…/exec`). |
| `ADMIN_KEY` | Shared secret used to authenticate the admin dashboard. Must match the value stored in GAS Script Properties. |
| `ALLOWED_ORIGINS` *(optional)* | Comma-separated list of allowed browser origins. If unset, CORS is `*`. |

### Rotating `ADMIN_KEY`

The admin key previously shipped with a hard-coded fallback (`agency2025admin`).
That fallback has been removed. To rotate:

1. Pick a new strong value.
2. Set it in **Vercel** → Settings → Environment Variables → `ADMIN_KEY`.
3. Open the Apps Script project and go to **Project Settings → Script
   properties**. Add/update a property `ADMIN_KEY` with the same value.
4. Redeploy the Apps Script web app (Deploy → Manage deployments → Edit →
   Deploy).
5. Re-deploy Vercel (pushing a commit or using Vercel dashboard).

## Admin dashboard

- Enter the page, toggle the discreet admin switch in the header, type the
  `ADMIN_KEY` password. A session token is stored in `sessionStorage`.
- Bookings tab: filter by package (pill cards) / status (chips) / free text,
  edit status by clicking the status chip, export to Excel / PDF / Word. Export
  filenames embed the active filter, e.g. `حجوزات_عمرة_جوان_2026.pdf`.
- Packages tab: create / edit / publish / unpublish offers, including
  departure date (`travelStart`) and return date (`travelEnd`).

## Folder layout

```
Haoues-Travel/
├── index.html
├── assets/
│   ├── css/style.css
│   ├── js/script.js
│   └── fonts/…
├── api/                 # Vercel serverless functions
├── Code.gs              # Google Apps Script backend (deploy to Apps Script)
├── logo/                # Site logo assets
├── vercel.json          # Headers / cache rules / rewrites
└── package.json
```

## License

© Abu Ilyas Umrah. All rights reserved.
