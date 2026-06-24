---
name: robinhood-setup
description: Connect Robinhood to Dex to surface portfolio value, positions, and recent trades
integration:
  id: robinhood
  name: Robinhood
  auth: username_password
  category: finance
  sync_direction: read
  api:
    library: robin_stocks
    install: pip install robin_stocks
    key_env_vars:
      - ROBINHOOD_USERNAME
      - ROBINHOOD_PASSWORD
  enhances:
    - skill: daily-plan
      capability: "Portfolio equity and top movers shown in your daily context"
    - skill: week-review
      capability: "Weekly P&L and notable trades included in review"
  new_capabilities:
    - name: Portfolio Overview
      trigger: "Ask 'how's my Robinhood?' or 'what's my portfolio worth?'"
    - name: Position Lookup
      trigger: "Ask 'what do I hold in Robinhood?' or 'show my positions'"
    - name: Stock Quotes
      trigger: "Ask 'what's AAPL trading at?' — Dex fetches live price"
    - name: Order History
      trigger: "Ask 'show my recent Robinhood trades'"
---

# Robinhood Setup

Connect your Robinhood account to Dex so you can ask about your portfolio, positions, and trades in natural language.

Dex uses **robin_stocks**, a Python library that talks to Robinhood's internal API. Your credentials are stored locally in a `.env` file at your vault root — never committed or sent anywhere except Robinhood's own servers.

## What This Enables

Once connected, you can ask:
- "How's my Robinhood portfolio?"
- "What's my total equity?"
- "Show my current positions with P&L"
- "What's Tesla trading at right now?"
- "Show my recent trades"
- "How much have I earned in dividends?"

**Skill enhancements:**
- **Daily Plan** — portfolio equity and notable moves can appear in your morning context
- **Week Review** — weekly P&L and significant trades included

## Privacy & Security

- Credentials (`ROBINHOOD_USERNAME`, `ROBINHOOD_PASSWORD`) are stored only in `VAULT_ROOT/.env`, which is gitignored and never committed
- A session token is cached at `System/integrations/robinhood_token.pkl` (also gitignored) so Dex re-uses your login across sessions
- Dex only **reads** data — it never places orders or moves money
- ScreenPipe blocks `robinhood.com` by default, so account screens are never captured

## When to Run

- User types `/robinhood-setup`
- User asks "connect my Robinhood" or "set up Robinhood"
- User asks about portfolio/positions and Robinhood isn't connected

---

## Setup Flow

> Dex handles all file writes. The user only ever types their credentials into the chat.

### Step 1: Check if Already Connected

1. Check `System/integrations/config.yaml` for a `robinhood` section with `enabled: true`.
2. Check for `ROBINHOOD_USERNAME` and `ROBINHOOD_PASSWORD` in the environment or `VAULT_ROOT/.env`.
3. If both are found, attempt a quick connection check via `robinhood_check_available`.
   - **If it succeeds** → tell the user they're already connected, skip to Step 6 (show what's enabled).
   - **If it fails (auth error)** → credentials may be stale, continue to Step 2.
4. If no credentials found, continue to Step 2.

### Step 2: Check for robin_stocks

Before asking for credentials, verify the dependency is installed:

```bash
python -c "import robin_stocks" 2>/dev/null && echo "ok" || echo "missing"
```

- **If missing:**
  ```
  Robinhood needs the robin_stocks Python library first.

  Run this in your terminal:
    pip install robin_stocks

  Then come back and run /robinhood-setup again.
  ```
  Stop here and wait for the user to install it.

- **If installed:** continue.

### Step 3: Explain What's Happening

```
I'll connect Dex to your Robinhood account so you can ask about your 
portfolio, positions, and trades — all read-only, no trades will ever 
be placed.

Your credentials will be stored locally in your vault's .env file 
(gitignored, never committed).

If your account uses two-factor authentication (most do), Robinhood 
will send a verification code to your phone or email the first time 
Dex logs in. I'll walk you through that.
```

### Step 4: Collect Credentials

Ask for username first, then password separately:

```
What's your Robinhood username (usually your email address)?
```

Wait for the username. Then:

```
And your password? (I'll store it securely in your local .env — it 
never leaves your machine except to Robinhood's servers.)
```

**Never log or display the password back to the user.**

### Step 5: Store and Verify

**Store credentials (Dex does this):**

1. Locate `VAULT_ROOT/.env`. Create it if it doesn't exist.
2. Write or replace these lines:
   ```
   ROBINHOOD_USERNAME=<username>
   ROBINHOOD_PASSWORD=<password>
   ```
   Replace existing lines if present; append if absent.
3. Confirm `.env` is gitignored (it is by convention).

**Verify connection:**

Call `robinhood_check_available`. This will attempt to log in and load the account profile.

- **If Robinhood sends an MFA code:**
  The login will pause waiting for a verification code. Prompt the user:
  ```
  Robinhood sent a verification code to your phone or email.
  What's the code?
  ```
  Pass the code to complete authentication. robin_stocks handles this automatically when the `mfa_code` is provided to `rs.login()`.

- **On success:**
  ```
  Connected — Dex can see your Robinhood account.
  ```
  Continue to Step 6.

- **On auth failure:**
  ```
  That login didn't work.

  Common reasons:
  - Incorrect password (check caps lock)
  - Wrong username (should be your email address)
  - Your account requires an app-based MFA code that wasn't provided

  Want to try again?
  ```
  Offer to retry (back to Step 4). Allow up to 2 retries, then suggest coming back later.

- **On network error:** report briefly and offer to retry.

### Step 6: Save Configuration

Write or update the `robinhood` block in `System/integrations/config.yaml`. Preserve all other sections.

```yaml
robinhood:
  enabled: true
  configured_at: YYYY-MM-DD
  auth_type: username_password
  library: robin_stocks
  username_env_var: ROBINHOOD_USERNAME   # value lives in .env, never here
  password_env_var: ROBINHOOD_PASSWORD   # value lives in .env, never here
  features:
    portfolio: true
    positions: true
    quotes: true
    orders: true
    dividends: true
```

Never write the actual username or password into `config.yaml`.

### Step 7: Confirm with Capability Cascade

```
Robinhood is connected!

Here's what you can do now:

- **Portfolio overview** — "How's my Robinhood?" shows equity, cash, and buying power
- **Positions** — "Show my positions" lists holdings with current value and unrealized P&L  
- **Live quotes** — "What's AAPL at?" fetches a real-time price
- **Recent trades** — "Show my last 10 orders" surfaces buy/sell history
- **Dividends** — "How much have I earned in dividends?" totals paid dividends

Next: just ask me anything about your portfolio.

You can re-run /robinhood-setup anytime to update your password or disconnect.
```

---

## Reconfiguration

If the user runs `/robinhood-setup` when already connected:

1. Run `robinhood_check_available` to test the current credentials.
2. Show the current config from `System/integrations/config.yaml`.
3. Offer options:
   - **Update password** — collect new password, update `.env`.
   - **Re-test the connection.**
   - **Disconnect Robinhood.**

### Disconnect Flow

If the user wants to disconnect:

1. Update `System/integrations/config.yaml`:
   ```yaml
   robinhood:
     enabled: false
   ```
2. Remove `ROBINHOOD_USERNAME` and `ROBINHOOD_PASSWORD` lines from `VAULT_ROOT/.env`.
3. Delete `System/integrations/robinhood_token.pkl` if it exists.
4. Confirm: "Robinhood disconnected. Run `/robinhood-setup` anytime to reconnect."

---

## Troubleshooting

### Login keeps failing
- Double-check your email address and password on robinhood.com first
- If your account uses SMS or email MFA, make sure you have access to the code when Dex prompts for it
- Some accounts with app-based authenticators (Google Authenticator) may need the TOTP code entered at the MFA prompt

### "robin_stocks not installed"
Run `pip install robin_stocks` in your terminal, then try `/robinhood-setup` again.

### Session expired mid-session
The server logs back in automatically using your stored credentials. If auto-relogin fails, run `/robinhood-setup` to re-enter your password.

### Two-factor code rejected
MFA codes are time-sensitive (30 seconds). Enter the code quickly after it appears, or request a new one.
