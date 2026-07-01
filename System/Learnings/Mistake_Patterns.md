# Mistake Patterns

Track recurring mistakes to prevent them. When you notice something going wrong repeatedly, document it here so the AI can help you avoid it.

## Active Patterns

> Add patterns here as you discover them. Each pattern should have:
> - A clear name
> - What triggers it
> - The impact
> - How to avoid it

### Example Pattern — Task Scope Creep
- **Trigger**: Starting a task without clear boundaries
- **Impact**: Tasks take 3x longer than expected
- **Mitigation**: Always define "done" before starting

### Salesforce queries not scoped to owned accounts
- **Trigger**: Any account/asset/EDA query for personal pipeline work ("my customers", prospect/conquest lists) that doesn't filter on account owner
- **Impact**: Pulls colleague-owned accounts into personal pipeline work (territory violation); wasted a 23-shop conquest list (19 were colleagues') and put 5 colleague accounts into outreach drafts
- **Mitigation**: Always scope to owned accounts — `OwnerId = '0055Y00000GU69oQAD'` (Chris) — **unless the intent is explicitly cross-territory analysis**. Pull Vendor record types regardless of owner. See System/Learnings/Salesforce_Analysis_Learnings.md

### Repeated live Salesforce pulls for the same data
- **Trigger**: Re-querying Salesforce live for each ad-hoc analysis or large dataset
- **Impact**: Unnecessary re-querying, token-limit spillovers, inconsistent snapshots across questions
- **Mitigation**: Handle large result sets via **local processing** off a weekly-synced local dataset rather than repeated Salesforce pulls. Reserve live SF calls for real-time validation only

### Treating "overdue close date" as a "dead deal" indicator
- **Trigger**: Filtering pipeline for dead/stalled deals using CloseDate alone
- **Impact**: Mislabels active deals — overdue close date is purely a **scheduling signal**, not a death signal (Chris doesn't move close dates as deals advance)
- **Mitigation**: Apply the correct logic:
  - Overdue **+ no recent activity** = likely at-risk / stale
  - Overdue **+ recent activity** = still active; needs date alignment or next-step update
  - A deal is **dead only when explicitly marked closed / lost / dead in Salesforce**

---

## Resolved Patterns

> Move patterns here when you've successfully changed the behavior

---

## How to Use

1. When you notice a recurring mistake, add it to Active Patterns
2. Include specific triggers so the AI can spot them early
3. Once you've changed the behavior for 2+ weeks, move to Resolved
4. Review this file during weekly reviews

The AI will surface relevant patterns during session start.
