---
name: salesforce-quote-email
description: Parse an inbound quote-request email, match Salesforce records, collect any missing details interactively, and create a Quote linked to the correct Opportunity — with all attachments uploaded and an audit task logged.
---

Turn inbound quote-request emails into Salesforce Quotes in a guided, review-before-you-commit workflow. Nothing is written to Salesforce until you approve the confirmation screen.

## Usage

`/salesforce-quote-email` — start the workflow interactively

---

## Step 0: Check Authentication

Run silently before saying anything to the user:

**SF auth check** — if `sf_authenticate` tokens don't exist, prompt:
```
Salesforce isn't connected yet. I'll open a browser window — log in and approve access, then come back here.
```

(No git sync needed — Power Automate writes files directly to OneDrive, which syncs to your local vault automatically.)

---

## Step 1: Get the Email

**Do not ask the user to paste anything yet.** Call `email_read_pending` silently.

### If files are found in pending/:

Show them and ask which to process:

```
📬 Found [N] email(s) in your quote inbox:

  [1] From: [sender]
      Subject: [subject]
      Date: [date]
      Attachments: [list or "none"]

  [2] ...

Which one? (number, "all" to process each in sequence, or "paste" to enter a different email manually)
```

Wait for selection. Use that email's content for Step 2. After the quote is successfully created in Step 7, call `email_archive_pending` with the filename — it moves the file locally from `pending/` to `processed/`, and OneDrive syncs the change automatically.

### If pending/ is empty or the folder doesn't exist:

```
No emails in your quote inbox yet.

**Power Automate setup (one-time, ~5 min):**
See the setup guide below, then forward yourself a test email and run
/salesforce-quote-email again.

Or — paste an email now and I'll process it directly.
```

Show the setup guide from the ## Power Automate Setup section at the bottom of this file, then wait.

### Fallback: user pastes email

Accept pasted text in any format. Extract From, Subject, Date, and body. Note any attachment file paths they share separately.

---

### Attachment note

If attachment filenames are mentioned in the email body and the PA flow saved the email to the pending folder, the actual attachment files won't be there — just the text. Ask the user:
```
The email mentions attachments: [list]. Do you have the files saved somewhere? Share the file paths and I'll upload them to Salesforce.
```

---

## Step 2: Extract Structured Quote Data

Analyze the email text (and any inline attachment text the user has shared) and extract the following. For each field, note your confidence: **High** (explicit in email), **Medium** (inferred from context), or **Low** (guessing).

Present your extraction as a clean summary:

```
📧 Email Parsed
───────────────────────────────────────────
From:           [sender name + email]
Company:        [company name] — confidence: High/Medium/Low
Contact:        [contact name] — confidence: High/Medium/Low
Date sent:      [YYYY-MM-DD]
Subject:        [subject line]

Quote Request Details
───────────────────────────────────────────
Machine type:   [e.g. Press Brake, Laser, VMC] — confidence: High/Medium/Low
Manufacturer:   [e.g. Trumpf, Amada, Mazak] — confidence: High/Medium/Low
Model:          [specific model] — confidence: High/Medium/Low
Quantity:       [number] — confidence: High/Medium/Low
Pricing info:   [any prices mentioned, or "none found"]
Notes:          [any other context — application, material, tonnage, etc.]

Attachments mentioned: [list filenames if referenced in email body]
Attachment paths provided: [list any paths the user gave]
```

If multiple machines are requested, list each one as a separate item under "Quote Request Details."

---

## Step 3: Locate Salesforce Records

Run these lookups in sequence:

### 3a — Search for Account + Contact

Use `sf_search_contacts` with the sender's name or email domain. Also use `sf_get_account` with the company name.

Show what you found:
```
Salesforce Lookup
───────────────────────────────────────────
Account:   [Account Name] (Id: 001...) ✓ Found   — OR —   ✗ Not found
Contact:   [Contact Name] (Id: 003...) ✓ Found   — OR —   ✗ Not found
```

### 3b — Search for Opportunity

Use `sf_search_opportunities` with the account name, contact name, and any machine type context extracted from the email.

**If one clear match:** show it and say "I'll link the quote to this opportunity — confirm or tell me which to use."

**If multiple matches (2-5):** display them in a numbered list:
```
I found [N] open opportunities. Which one should this quote be linked to?

  [1] Acme Corp — TruBend 5085 Inquiry (Stage: Proposal, $45,000, closes 2026-09-30)
  [2] Acme Corp — Press Brake Replacement (Stage: Needs Analysis, $60,000, closes 2026-11-15)

Reply with the number, or "new" to create a new Opportunity first.
```

**If no match:** say:
```
I didn't find an open opportunity for [Company]. 
  → Reply "new" and I'll prompt you to create one in Salesforce first.
  → Or paste the Opportunity Id directly and I'll link to it.
```

Wait for the user's selection before continuing.

---

## Step 4: Identify Required Fields and Gaps

After the opportunity is confirmed, use `sf_get_opportunity` to pull its full details (Account, Stage, close date, existing contacts, existing quotes).

**Discover custom fields (do this once per session):** Call `sf_describe_object` with `object_name="Quote"` and `custom_only=true`, then call it again with `object_name="QuoteLineItem"` and `custom_only=true`. Surface any custom fields that have values extractable from the email (e.g. `Machine_Type__c`, `Vendor__c`) and ask for any required custom fields that couldn't be extracted.

Then build a gap list — fields needed to create the quote that weren't found in the email or Salesforce:

Required:
- Quote Name (I'll suggest one: "[Account] — [Machine/Model] Quote — [Date]")
- Expiration Date
- Payment Terms
- Shipping Terms

Optional but commonly needed:
- Price Book (call `sf_get_pricebooks` and show options)
- Products / line items (for each machine: model, quantity, price)
- Billing/Shipping name
- Any required custom fields found via `sf_describe_object`

Ask for missing required fields in one consolidated block — not one at a time:

```
A few things I need before I can create the quote:

  Quote Name:       [suggested name] — OK? or enter a different name
  Expiration Date:  ? (e.g. 2026-09-22, or "30 days", "60 days")
  Payment Terms:    ? (e.g. Net 30, 50% deposit / 50% on delivery)
  Shipping Terms:   ? (e.g. FOB Destination, FOB Origin)

  Price Book:
    [1] Standard Price Book (default)
    [2] [Other pricebook name if found]
    Reply with number or "skip" if not using a price book.

  [Any required custom Quote fields not extractable from the email — show label, not API name]

Reply with answers in order, or press Enter to accept a suggestion.
```

Wait for the user's answers.

---

## Step 5: Resolve Line Items

For each machine/product identified in the email:

1. Call `sf_get_pricebook_entries` with the selected pricebook and machine name/model to search for a matching product.

2. If a match is found:
   ```
   Product match: "[Product Name]" — $[list price] — use this? (yes / enter different price / skip)
   ```

3. If no match:
   ```
   No catalog entry found for "[Machine/Model]". 
   Options:
     a) Enter a custom price: $_____ (I'll note the product in the line item description)
     b) Skip — add the line item manually in Salesforce after creation
   ```

4. For each confirmed line item, also collect any custom QuoteLineItem fields discovered in Step 4 (e.g. `Machine_Type__c`, `Model__c`, serial number fields). Pre-fill from the email where possible and confirm.

5. Collect the full confirmed list: product name, quantity, unit price, description, and any custom field values.

**Single item:** will use `sf_add_quote_line_item` in Step 7.
**Multiple items:** will use `sf_add_quote_line_items` (one batch call) in Step 7.

If there are no products in the pricebook at all, skip line items and say:
```
No products found in the selected pricebook. The quote will be created without line items — you can add them directly in Salesforce.
```

---

## Step 6: Confirmation Screen

Before writing anything to Salesforce, display the full proposed record:

```
╔══════════════════════════════════════════════════════════════╗
║              SALESFORCE QUOTE — READY TO CREATE              ║
╚══════════════════════════════════════════════════════════════╝

Account:         [Account Name]
Contact:         [Contact Name] ([email])
Opportunity:     [Opportunity Name] — Stage: [Stage]

Quote Name:      [Quote Name]
Status:          Draft
Expiration:      [Date]
Payment Terms:   [Terms]
Shipping Terms:  [Terms]
Price Book:      [Name]

Line Items:
  [1] [Product Name] — Qty: [N] — Unit Price: $[X] — Total: $[Y]
      Description: [machine details/specs]
  [2] ...

Quote Description / Notes:
  [extracted notes from email]

Attachments to upload:
  • [filename1] → will be attached to the Quote
  • [filename2] → will be attached to the Quote

Activity Task:
  Subject: Email: Quote Request — [Machine/Model] from [Contact]
  Type: Email
  Linked to: [Opportunity Name]

⚠️  Fields that could not be determined:
  • [Any field still unknown]

─────────────────────────────────────────────────────────────
Type "create" to proceed, or edit any field before confirming.
To change a field: "change [field] to [value]"
─────────────────────────────────────────────────────────────
```

Support edits: if the user says "change expiration to 2026-10-01", update that field in the pending record and refresh the confirmation display. Accept edits until the user says "create."

---

## Step 7: Create Salesforce Records

Execute in this order:

### 7a — Create the Quote

Call `sf_create_quote` with all confirmed fields. If it fails, show the error and stop — do not proceed with partial creation.

```
✓ Quote created: [Quote Number] (Id: 0Q0...)
```

### 7b — Add Line Items

**If one line item:** call `sf_add_quote_line_item` with `custom_fields` set to any custom QuoteLineItem values.

**If two or more line items:** call `sf_add_quote_line_items` once with the full array — each item can carry its own `custom_fields`. This is one API call regardless of how many items there are.

```
✓ Line items added: [N]/[N] (all succeeded)
✗ Line item failed: [Product Name] — [error] (you'll need to add this manually in Salesforce)
```

### 7c — Upload Attachments

For each file path the user provided, call `sf_upload_file` with the Quote Id as the linked record. Also upload a copy linked to the Opportunity Id.

```
✓ Uploaded: [filename] → attached to Quote + Opportunity
✗ Upload failed: [filename] — [error] — file may not be accessible in this environment
```

### 7d — Log the Activity Task

Call `sf_create_task`:
- Subject: `Email: Quote Request — [Machine/Model] from [Contact Name]`
- Type: `Email`
- Status: `Completed`
- ActivityDate: [date the email was sent]
- WhatId: [Opportunity Id]
- WhoId: [Contact Id if found]
- Description: Full email body + extraction summary + list of uploaded files + quote number

```
✓ Activity logged: Task Id [00T...]
```

### 7e — Write Audit Log

Append to `System/audit/salesforce-quotes.md` (create if it doesn't exist):

```markdown
## [YYYY-MM-DD HH:MM] — [Quote Name]

- **Quote:** [Quote Number] — [Quote URL]
- **Opportunity:** [Opportunity Name] — [Opportunity URL]
- **Account:** [Account Name]
- **Contact:** [Contact Name] ([email])
- **Email date:** [date]
- **Machines:** [machine list]
- **Line items created:** [N] / [N attempted]
- **Attachments uploaded:** [filenames]
- **Task:** [Task Id]
- **Created by:** Dex /salesforce-quote-email skill
```

---

## Step 8: Final Summary

```
╔══════════════════════════════════════════════════════════════╗
║                    QUOTE CREATED ✓                           ║
╚══════════════════════════════════════════════════════════════╝

Quote Number:    [Q-XXXXX]
Quote URL:       [Salesforce URL]
Opportunity:     [Opportunity Name]
Opportunity URL: [Salesforce URL]

Created:
  ✓ Quote with [N] line item(s)
  ✓ [N] attachment(s) uploaded
  ✓ Activity task logged

Could not be determined:
  • [Any fields left blank — with explanation]

Next steps:
  • Open the quote in Salesforce to review and send
  • [Any specific next actions based on email context]
```

---

## Error Handling

- **Auth failure:** stop and say "Run `/salesforce-quote-email` again — Salesforce needs re-authentication. Run `sf_authenticate` first."
- **No matching opportunity:** offer to create one or accept a direct Id paste
- **Quote creation fails:** show the raw Salesforce error + suggest which field to fix
- **File not found:** note it in the summary, continue with other files
- **Line item fails:** note it, suggest adding manually, continue with other items

## Confidence Rules

- **≥ 90% confidence:** use the extracted value without asking
- **< 90% confidence:** show it as a suggestion and ask for confirmation
- **Never silently overwrite** existing Salesforce data — always show what will change

## Multi-Machine Handling

If the email requests multiple machines:
- Extract each as a separate line item with its own quantity, manufacturer, and model
- Search for each one separately in the pricebook
- Display all in the confirmation screen before creating anything
- Attach all source documents to the quote (they all reference the same request)

---

## Power Automate Setup Guide

**Goal:** When a quote-request email arrives in your Outlook inbox, PA automatically writes a text file to `Inbox/Emails/pending/` in your OneDrive. OneDrive syncs it to your local vault within seconds. When you run `/salesforce-quote-email`, the skill reads those files directly — no copy-paste needed.

**One-time setup (~5–10 min):**

### Before you start — confirm your OneDrive path

Your vault is at `Documents\dex`. If OneDrive syncs your Documents folder (the default on Windows 11), then the OneDrive path PA needs is:

```
/Documents/dex/Inbox/Emails/pending
```

To verify: open OneDrive on your PC, browse to `Documents → dex → Inbox → Emails` and confirm it's there. If your vault isn't inside OneDrive at all, you'll need to move it or enable "Known Folder Move" for Documents in OneDrive settings first.

---

### Step 1 — Create the flow

1. Go to **make.powerautomate.com** and sign in with your work/Microsoft account
2. Click **+ Create** → **Automated cloud flow**
3. Name it: `Quote Email → Dex`
4. Trigger: search for **"When a new email arrives (V3)"** → Outlook 365 → click **Create**

### Step 2 — Configure the trigger

In the trigger settings:
- **Folder:** Inbox (or whichever folder quote emails land in)
- **Include Attachments:** No
- **Only with Attachments:** No
- Click **Show advanced options**
  - **Subject Filter:** `quote` (or leave blank and filter in the Condition step)
  - **From:** leave blank to catch all, or enter customer domains separated by `;`

### Step 3 — Add a Condition (optional but recommended)

- Click **+ New step** → search **Condition**
- Condition: `Subject` **contains** `quote` **OR** `Subject` **contains** `RFQ` **OR** `Subject` **contains** `pricing`
- Put the next step inside the **Yes** branch

### Step 4 — Add the OneDrive action

Inside the Yes branch (or directly after the trigger if you skipped the Condition):

1. Click **+ Add an action** → search **OneDrive for Business** → select **"Create file"**
   - If your account uses personal OneDrive (not work), search **OneDrive** instead
2. Sign in when prompted
3. Fill in the action:
   - **Folder Path:** click the folder icon and navigate to:
     ```
     Documents/dex/Inbox/Emails/pending
     ```
     (If the folder doesn't exist yet, create it in File Explorer first — OneDrive will sync it)
   - **File Name:** click the field, then open the **Expression** tab and enter:
     ```
     concat(formatDateTime(triggerOutputs()?['body/receivedDateTime'], 'yyyyMMdd-HHmmss'), '-quote.txt')
     ```
     This produces names like `20260623-143022-quote.txt` — always unique.
   - **File Content:** click the field, then open the **Expression** tab and enter:
     ```
     concat(
       'From: ', triggerOutputs()?['body/from'], decodeUriComponent('%0A'),
       'Subject: ', triggerOutputs()?['body/subject'], decodeUriComponent('%0A'),
       'Date: ', triggerOutputs()?['body/receivedDateTime'], decodeUriComponent('%0A'),
       decodeUriComponent('%0A'),
       triggerOutputs()?['body/body']
     )
     ```
     PA saves the raw email body here (which may be HTML). The Dex MCP server automatically strips HTML tags when it reads the file, so you'll always get clean plain text in the quote workflow.

### Step 6 — Save and test

1. Click **Save**
2. Forward yourself a sample quote email (subject line containing "quote")
3. Watch the flow run in the **Run history** panel — it should show a green checkmark
4. Check that the file appeared in `Documents\dex\Inbox\Emails\pending\` on your PC
5. Open a Claude Code session, run `/salesforce-quote-email`, and confirm it picks up the file

### Troubleshooting

| Problem | Fix |
|---|---|
| Flow didn't trigger | Check the folder filter in the trigger — confirm the email landed in the folder you set |
| OneDrive "Create file" fails with path error | Browse to the folder using the folder picker instead of typing the path manually |
| File shows up but body is blank | Try `body/bodyPreview` instead of `body/body` in the File Content expression |
| Body shows HTML tags in the skill output | The server strips HTML automatically — verify the saved file has a `.txt` extension so the right parser runs |
| File never appears on local PC | OneDrive sync may be paused — check the OneDrive tray icon and resume sync |
| Duplicate files created | The timestamp expression guarantees uniqueness — if you see duplicates, the flow ran twice (check the trigger settings) |

### After setup

Every matching email automatically drops a file into `Inbox/Emails/pending/` on your local machine within seconds of arriving. Run `/salesforce-quote-email` any time — it reads whatever is waiting, shows you the list, and processes your selection end-to-end.
