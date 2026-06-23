---
name: salesforce-quote-email
description: Parse an inbound quote-request email, match Salesforce records, collect any missing details interactively, and create a Quote linked to the correct Opportunity — with all attachments uploaded and an audit task logged.
---

Turn inbound quote-request emails into Salesforce Quotes in a guided, review-before-you-commit workflow. Nothing is written to Salesforce until you approve the confirmation screen.

## Usage

`/salesforce-quote-email` — start the workflow interactively

---

## Step 0: Check Authentication

Call `sf_authenticate` only if Salesforce isn't connected yet. If tokens already exist (sf_tokens.json present), skip this step silently and proceed.

If not authenticated:
```
Salesforce isn't connected yet. I'll open a browser window — log in and approve access, then come back here.
```

---

## Step 1: Collect the Email

Say:
```
Paste the full email below — subject line, From/To/Date header, and body.

If you have attachments (PDFs, Word docs, Excel files), share their file paths on separate lines after the email. I'll extract what I can from the text and upload the files to Salesforce.

(If you're running on the web, note that file uploads from cloud sessions require the files to be accessible on the server where Dex is running.)
```

Wait for the user to provide the email. Do not proceed to Step 2 until you have it.

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

4. Collect the confirmed line items with: product name, quantity, unit price, description.

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

For each confirmed line item, call `sf_add_quote_line_item`.

```
✓ Line item added: [Product Name] × [Qty]
✗ Line item failed: [Product Name] — [error] (you'll need to add this manually)
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
