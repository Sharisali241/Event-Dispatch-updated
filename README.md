# Happenings.co - Event Management System

> A comprehensive event management solution for booking, invoicing, inventory management, and client communication.

[![License](https://img.shields.io/badge/license-Proprietary-red.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/happenings-co/event-dispatch)

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Getting Started](#getting-started)
- [Usage Guide](#usage-guide)
- [System Architecture](#system-architecture)
- [WhatsApp Integration](#whatsapp-integration)
- [Data Management](#data-management)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## 🎯 Overview

**Happenings.co Event Management System** is a single-page application designed to streamline event planning operations. Built with vanilla JavaScript against a Supabase backend, it provides a complete solution for managing bookings, generating professional invoices and quotations, tracking inventory, and communicating with clients via WhatsApp.

### Key Highlights

- **No Build Step**: One `index.html` plus one serverless function - nothing to compile or bundle
- **Cloud-Backed**: All records live in Supabase (Postgres) and are shared across every device
- **Multi-Device**: Sign in anywhere; bookings, inventory and media stay in sync
- **Mobile-Optimized**: Responsive design for desktop and mobile devices
- **Print-Ready**: Professional PDF generation for invoices and quotations
- **WhatsApp Integration**: Direct client communication with pre-formatted messages

---

## ✨ Features

### 📅 Booking Management
- Create, edit, and track event bookings
- Filter bookings by status (Upcoming, Confirmed, Completed, Incomplete)
- Comprehensive booking details including client info, event type, venue, and dates
- Reference number generation for easy tracking
- Payment tracking (total, advance, balance)

### 📄 Invoice & Quotation Generation
- **Invoice Builder**: Create detailed invoices with line items
- **Quotation Builder**: Generate professional quotations with manual total override
- **Print/PDF Export**: High-quality PDF generation using html2pdf.js
- **Preview Mode**: Live preview before printing
- **WhatsApp Sharing**: Send invoices and quotations directly via WhatsApp

### 📦 Inventory Management
- Track inventory items with images and quantities
- Category-based organization
- Real-time availability checking
- Reserved items tracking per booking
- Low stock alerts

### 🚚 Dispatch Management
- Dispatch sheet generation for event execution
- Item reservation and allocation
- Visual dispatch hub with upcoming bookings
- Print-ready dispatch sheets with company branding

### 💬 WhatsApp Integration
- **Booking Confirmation**: Send detailed booking summaries to clients
- **Invoice Sharing**: Share professional invoices with payment details
- **Quotation Sharing**: Send quotations with itemized pricing
- **Dispatch Notifications**: Notify team members about upcoming dispatches
- Pre-formatted messages with all relevant details

### 📊 Finance Tracking
- Client cost vs internal cost comparison
- Payment status monitoring
- Balance due tracking
- Financial overview dashboard

### 📸 Media Gallery
- Upload and manage event photos
- Category-based organization
- Tag-based filtering
- Inspiration board for client presentations

---

## 🚀 Getting Started

### Prerequisites

- Modern web browser (Chrome, Firefox, Safari, Edge)
- A Supabase project (database + auth)
- A Cloudflare R2 bucket, for media uploads
- A Vercel account, to host the app and its one serverless function

### Local Usage

1. **Download the project**:
   ```bash
   git clone https://github.com/happenings-co/event-dispatch.git
   cd event-dispatch
   ```

2. **Open in browser**:
   ```bash
   # Simply open index.html in your browser
   open index.html
   # or
   firefox index.html
   # or double-click index.html
   ```

3. **Login**:
   - Authentication is Supabase email/password - there is no shared default password
   - Accounts are created in the Supabase dashboard (Authentication -> Users)
   - "Forgot password" only works for the one hardcoded address in `index.html`
     (search for `ALLOWED_RESET_EMAIL`)

> **Note:** opening `index.html` from the filesystem works for the UI, but `/api/get-upload-url`
> only exists when the app is served by Vercel, so media/photo uploads will fail locally.
> Use `vercel dev` if you need uploads while developing.

### Deploy to Vercel (Recommended for Production)

#### Option 1: Deploy via GitHub (Automatic)

1. **Push to GitHub**:
   ```bash
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```

2. **Connect to Vercel**:
   - Go to [vercel.com](https://vercel.com)
   - Click "New Project"
   - Import your GitHub repository
   - Click "Deploy"

3. **Done!** Your app will be live at `https://your-project.vercel.app`

#### Option 2: Deploy via Vercel CLI

1. **Install Vercel CLI**:
   ```bash
   npm install -g vercel
   ```

2. **Deploy**:
   ```bash
   cd event-dispatch
   vercel
   ```

3. **Follow prompts** and your app will be deployed

### Deployment Notes

- ⚠️ **Environment variables required** - the media upload function needs five `R2_*` vars
  (see [First-Time Setup](#first-time-setup)); everything else works without them
- ✅ **No build step required** - static HTML plus one buildless Node function
- ⚠️ **One API endpoint** - `/api/get-upload-url`, deployed from `api/get-upload-url.js`
  via `vercel.json`. The rest of the data layer talks to Supabase REST directly from the browser.
- ✅ **Instant deployment** - typically under 30 seconds
- ✅ **Free hosting** on Vercel's free tier
- ✅ **Automatic HTTPS** - Vercel provides SSL certificate
- ✅ **Global CDN** - Fast loading worldwide

### First-Time Setup

1. **Configure Company Details**:
   - Update `BN` (Business Name) variable in the code
   - Add company logo URL to `BL` variable
   - Update contact information (phone, address)

2. **Set up the database**:
   - Create a Supabase project and point `SU` / `SK` in `index.html` at it
   - Run `rls-policies.sql` in the Supabase SQL editor - this creates the Row Level
     Security policies. **Without it the anon key gives the whole internet read and
     write access to every table.**
   - Run `settings-table.sql` to create the shared `settings` table (inventory
     categories, finance columns, packages and media categories live there)
   - Create at least one user under Authentication -> Users

3. **Configure media uploads** (Vercel -> Settings -> Environment Variables):

   | Variable | Purpose |
   |---|---|
   | `R2_ACCOUNT_ID` | Cloudflare account id (the R2 endpoint subdomain) |
   | `R2_BUCKET` | Bucket name |
   | `R2_ACCESS_KEY_ID` | R2 API token access key id |
   | `R2_SECRET_ACCESS_KEY` | R2 API token secret |
   | `R2_PUBLIC_BASE` | Public base URL for reads, no trailing slash |

   The bucket also needs a CORS rule allowing `PUT` from the app's origin, otherwise the
   browser blocks the upload before it leaves the page.

---

## 📖 Usage Guide

### Creating a Booking

1. Navigate to **Bookings** section
2. Click **+ New Booking**
3. Fill in client details:
   - Name, phone
   - Event type, date, venue
   - Ready and pickup times
   - Notes
4. Add payment information (total, advance)
5. Click **Save Booking**

### Generating an Invoice

1. Open a booking from the **Bookings** list
2. Click **Generate Invoice**
3. Add invoice line items:
   - Description
   - Amount
4. Click **Preview Invoice**
5. Options:
   - **Print**: Generate PDF
   - **WhatsApp**: Send to client
   - **Edit**: Modify items

### Creating a Quotation

1. Navigate to **Quotes** section
2. Fill in client and event details
3. Add quotation items:
   - Category
   - Description (supports multi-line)
   - Amount
4. Optional: Override total with manual amount
5. Click **Preview Quotation**
6. Options:
   - **Print**: Generate PDF
   - **WhatsApp**: Send to client

### Managing Inventory

1. Navigate to **Inventory** section
2. Click **+ Add Item**
3. Fill in item details:
   - Name, category
   - Quantity available
   - Upload image (optional)
4. Items are automatically tracked across bookings

### Dispatching Items

1. Navigate to **Dispatch** section
2. Select a booking from the dispatch hub
3. Choose items to dispatch:
   - Browse by category
   - Select quantity for each item
4. Add inspiration photos (optional)
5. Click **Generate Dispatch Sheet**
6. Options:
   - **Print**: Generate dispatch sheet
   - **WhatsApp**: Notify team

---

## 🏗️ System Architecture

### Technology Stack

- **Frontend**: Vanilla JavaScript (ES6+), single `index.html`
- **Styling**: Custom CSS with CSS Variables
- **PDF Generation**: html2pdf.js (CDN)
- **Database**: Supabase (Postgres) via the REST API and `@supabase/supabase-js` (CDN)
- **Auth**: Supabase email/password
- **File Storage**: Cloudflare R2, via a presigned-URL endpoint on Vercel
- **Hosting**: Vercel (static `index.html` + one Node serverless function)
- **Icons**: Unicode emojis
- **Fonts**: Google Fonts (Cormorant Garamond, Jost)

### Where Data Lives

| Data | Location |
|---|---|
| Bookings, inventory, staff, media, tasks | Supabase tables |
| Categories, finance columns, packages, media categories, finance PIN | Supabase `settings` table |
| Uploaded photos and files | Cloudflare R2 (URLs stored in Supabase) |
| Business name/logo, current screen, unsaved drafts | Browser localStorage |

### Data Structure

```javascript
// bookings  (column names as stored in Supabase)
{
  id: "b1735113600000",
  ref: "HAP20260824-001",     // HAP<YYYYMMDD>-NNN, suffix derived from the DB
  name: "Client Name",
  phone: "03001234567",
  type: "Wedding",
  date: "2026-12-25",
  venue: "Grand Hall",
  ready: "6:00 PM",
  pickup: "11:00 PM",
  total: 500000,
  paid: 200000,
  status: "Confirmed",
  notes: "",
  dispatch_items: [...],
  pending_items: [...],       // external elements
  costs: {},                  // finance columns, keyed by column name
  reminder_notes: "",
  discussion_log: [],
  staff_assigned: [],
  invoice_items: [],
  event_inspos: []
}

// inventory
{
  id: "i1735113600000",
  name: "Item Name",
  cat: "Category",
  subcat: null,
  qty: 50,
  photo: "https://<r2-public-base>/2026-08-24/...jpg"
}
```

### File Structure

```
event-dispatch/
├── index.html              # The entire client application
├── api/
│   └── get-upload-url.js   # Presigns Cloudflare R2 uploads (SigV4, no deps)
├── vercel.json             # Static build + Node function routing, SPA fallback
├── rls-policies.sql        # Row Level Security policies — run in Supabase
├── settings-table.sql      # Shared settings table — run in Supabase
├── FIXES.md                # Audit findings and their status
├── README.md               # Documentation
└── .git/                   # Git repository
```

---

## 💬 WhatsApp Integration

### How It Works

The system generates pre-formatted WhatsApp messages with all relevant details and opens WhatsApp Web with the message ready to send. Users can then select the recipient and send.

### Message Formats

#### Booking Confirmation
```
Assalam o Alaikum,

*BOOKING CONFIRMATION* ✅
=================

*CLIENT DETAILS:*
*Name:* John Doe
*Reference:* HAP20260824-001
*Phone:* 03001234567

*EVENT DETAILS:*
*Event Type:* Wedding
*Date:* 2026-12-25
*Venue:* Grand Hall
*Ready Time:* 6:00 PM
*Pickup Time:* 11:00 PM

*PAYMENT DETAILS:*
*Total Amount:* PKR 500000
*Advance Paid:* PKR 200000
*Balance Due:* PKR 300000

Thank you for choosing us!
JazakAllah

*Happenings.co*
📞 03302894915
```

#### Invoice
```
Assalam o Alaikum,

*INVOICE* 📄
=================

*CLIENT DETAILS:*
*Name:* John Doe
*Event:* Wedding
*Date:* 25 Dec 2024

*INVOICE ITEMS:*
1. Stage Decoration
   *Amount:* PKR 150000
2. Catering Service
   *Amount:* PKR 200000

*PAYMENT SUMMARY:*
*Total Amount:* PKR 500000
*Advance Paid:* PKR 200000
*Balance Due:* PKR 300000

Thank you for your business!
JazakAllah
```

### Browser Compatibility

- ✅ Chrome/Edge: Full support
- ✅ Firefox: Full support
- ✅ Safari: Full support
- ✅ Mobile browsers: Full support

---

## 💾 Data Management

### Data Storage

Records live in Supabase, one table each:

- **Bookings**: `bookings`
- **Inventory**: `inventory`
- **Staff**: `staff`
- **Media**: `media`
- **Tasks**: `tasks`
- **Shared settings**: `settings` (categories, finance columns, packages, media categories, finance PIN)

localStorage holds only per-device state, not records:

| Key | Holds |
|---|---|
| `biz_n`, `biz_l` | Business name and logo |
| `cur_screen`, `cur_detail_id`, `cur_edit_bkn_id`, `inv_bkg_id` | Which screen/booking you were on |
| `ev_bkg_draft`, `cur_quote`, `cur_invoice_lines` | Unsaved drafts, so a refresh doesn't lose typing |
| `ev_cats`, `ev_cost_cols`, `ev_pkgs`, `ev_m_cats`, `ev_fin_p`, `ev_staff` | Local cache of the shared `settings` data |

### Backup & Export

Back up from Supabase, not from the browser:

1. Supabase dashboard → Table Editor → pick a table → **Export as CSV**, or
2. `pg_dump` against the connection string in Project Settings → Database, or
3. Enable Point-in-Time Recovery on a paid plan for automatic backups

Clearing browser data no longer destroys anything but drafts and UI state.

### Data Security

- Access requires a Supabase login (Authentication → Users)
- Table access is governed by the Row Level Security policies in `rls-policies.sql`.
  **These must actually be applied** — the anon key is embedded in `index.html`
  and is visible to anyone who views source, so without RLS every table is
  world-readable and world-writable.
- **The finance PIN is not a security control.** It is compared in the browser
  against a value the browser can read, so anyone with DevTools can walk past it.
  It exists to keep finance off the screen when someone is looking over your
  shoulder, nothing more. There is no default PIN — until someone sets one under
  Settings, the finance section simply opens. The PIN is shared across devices via
  the `settings` table and is stored there in clear text, readable by any signed-in
  user. Genuinely restricting finance data would mean moving `bookings.costs` into
  its own table with its own RLS policy; that has not been done.
- Uploaded files sit in Cloudflare R2 and are readable by anyone holding the URL.

---

## 🔧 Troubleshooting

### Common Issues

#### WhatsApp Not Opening
- **Issue**: WhatsApp button doesn't work
- **Solution**: Ensure you're using a modern browser with WhatsApp Web support

#### PDF Not Generating
- **Issue**: Print/PDF button doesn't work
- **Solution**: 
  - Check browser console for errors
  - Ensure html2pdf.js is loaded
  - Try a different browser

#### Data Lost or Not Loading
- **Issue**: Bookings or inventory disappeared
- **Solution**:
  - Check the browser console — a failed Supabase request shows the HTTP status
  - Confirm you are still signed in; an expired session makes reads return nothing
  - If RLS policies were just changed, verify the signed-in role can still `select`
  - Restore from a Supabase backup if rows were genuinely deleted

#### Uploads Failing
- **Issue**: Photos won't upload; console shows a JSON parse error or a 500
- **Solution**:
  - `/api/get-upload-url` returns a specific error naming any missing `R2_*` env var
  - Check the R2 bucket's CORS rule allows `PUT` from the app's origin
  - Uploads never work when `index.html` is opened from the filesystem

#### Images Not Loading
- **Issue**: Inventory or media images not displaying
- **Solution**:
  - Check image URLs are valid
  - Ensure images are accessible
  - Try re-uploading images

### Browser Console

For debugging, open browser console (F12) and check for error messages.

---

## 📄 License

**Proprietary License**

© 2024 Happenings.co. All rights reserved.

This software is proprietary and confidential. Unauthorized copying, distribution, or use of this software, via any medium, is strictly prohibited.

For licensing inquiries, contact: info@happenings.co

---

## 📞 Support

For support, feature requests, or bug reports:

- **Email**: support@happenings.co
- **Phone**: +92 330 2894915
- **Website**: https://happenings.co

---

## 🙏 Acknowledgments

- **html2pdf.js**: PDF generation library
- **Google Fonts**: Typography
- **Supabase**: Database and authentication
- **Cloudflare R2**: File storage
- **Vercel**: Hosting and serverless functions

---

**Built by HAMZA JABBAR**
