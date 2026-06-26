# ALLtra / Randy Outreach - Thursday, July 2, 2026

**Created:** 2026-06-26
**Trigger:** Randy (ALLtra factory rep) back in the area Thursday, July 2 - follow up open ALLtra plasma deals and re-engage existing older ALLtra plasma owners to request meetings/demos.
**Script:** `.scripts/outreach-alltra-randy-2026-07-02.ps1`

## Tier 1 - Open ALLtra opportunities (active quotes)

| Account | Recipient | Email | Opportunity | Amount | Stage | Notes |
|---|---|---|---|---|---|---|
| SMF Truck Equipment | Al Billig | abillig@smftruck.com | ALL - plasma (US-612) | $298,147 | Quoting | Quote 00019355 (Customer). Opp NextStep already says "schedule virtual meeting w/ Randy." Close date 6/30. |
| Gambone Steel Company, Inc. | Ralph Gambone | gambonesteel@aol.com | ALL - US-612 Plasma - Gambone | $220,873 | Quoting | Vendor: ALLtra Corp. NextStep: call Ralph to schedule meeting. |

## Tier 2 - Existing ALLtra plasma owners, older machines (~5 yrs, 2021) - UCC-1 EDA asset report

| Account | Recipient | Email | Machine | Purchased | Angle |
|---|---|---|---|---|---|
| Atlantic Metal Products Inc | Raymond Campbell | rayc@ampva.com | HG-16-10 | 2021-09-20 | Service/consumables + added capacity |
| Delaware Valley Steel Co | Jerry Sharpe (Pres) | jerry@delawarevalleysteel.com | HG16-12S-480v | 2021-02-05 | 12-ft refresh / current models |
| Protech Mechanical Inc | Harold Moore (Owner) | harold@protechnc.net | US-612 480V | 2021-12-06 | Parts/refresh/capacity |
| Steel Corp (Parent-RedGuard) | David Herrington (GM) | dherrington@steelcorpllc.com | PG-14 (sn 7217) | 2021-09-27 | Service + new lineup |
| Wiker Welding | Jim Wiker | wikerwelding@gmail.com | PG 14-6 Premium | 2021-05-26 | Consumables/service/newer systems |
| LaserForm & Machine, Inc. | Jeremy Ray (Owner) | jeremy@lfmsc.com | PG-14 | 2021-06-07 | Parts/service/capacity (smaller unit) |

## Before sending
- All recipients/emails pulled from Salesforce. Spot-check that each is the right person (e.g. SMF goes to Al Billig per your call).
- **Atlantic Metal Products (@ampva) - confirm contact.** It's a family business (Campbells). President **Raymond Campbell Jr** has no email on file. Working emails available: `rayc@ampva.com` (Raymond Campbell - used in script), `phil@ampva.com` (Phillip Campbell), `erica@ampva.com` (Erica Campbell). Swap if you know the right one.

## Tier 3 - CONQUEST: Mid-Atlantic fab shops w/ competitor plasma installed 2017-2020 (UCC-1 EDA)
**Script:** `.scripts/outreach-alltra-randy-conquest-2026-07-02.ps1` (23 drafts, decision-maker contacts pulled from Salesforce)

Filtered from the full EDA report: PA/NJ/DE/MD/VA fabrication shops (excluded hobby/HVAC-duct builders like Torchmate, PlasmaCam, Lockformer, Vicon, Swift-Cut). These shops span PA->VA, so they can't all be visited in one day - the emails seed interest; route confirmed responders into Randy's 7/2 itinerary by cluster (Hazleton PA and Delmarva are natural clusters).

| Account | City/ST | Contact | Plasma yr |
|---|---|---|---|
| JR Metal Products | Leola PA | John Petersheim | 2019 |
| K-Fab Inc | Berwick PA | Randy Barnes | 2018 |
| E & E Metal Fab | Lebanon PA | Willie Erb (CEO) | 2017 |
| Ebinger Iron Works | Schuylkill Haven PA | Bill Miller (Pres) | 2020 |
| Rearden Steel Fabrication | Lemoyne PA | Steve Capuano (Pres) | 2018 |
| Lingis Mfg & Machine | Sycamore PA | Greg Johnston | 2018 |
| Metal Stock | Philadelphia PA | Tyler Ruth (Ops Mgr) | 2018 |
| Integrated Fabrication & Machine | Greenville PA | Jim Braymer | 2019 |
| Kelly Iron Works | Hazleton PA | Padraig Kelly (Owner) | 2020 |
| Hazleton Iron | Hazleton PA | Russ Krobert | 2019 |
| Contrast Metalworks | Pottstown PA | Greg Rosenberger (Owner) | 2018 |
| Michelman Steel Enterprises | Bethlehem PA | Eric Michelman (Owner) | 2017 |
| Alessandra Misc. Metals | Newton NJ | Derek Compton (Plant Mgr) | 2019 |
| Eastern Shore Metals | Seaford DE | Chris Marvel | 2019 |
| Crystal Steel Fabricators | Delmar DE | Mike Mishler (VP Ops) | 2019 |
| Amazon Steel Construction | Milford DE | Martin Heesh (Pres) | 2017 |
| Miscellaneous Metals | Walkersville MD | Mark Kissner (Owner) | 2018 |
| Reedbird Steel | Odenton MD | Steve Hubbard (Owner) | 2019 |
| Patriot Steel Fabrication | Church Creek MD | Nathan Uncapher (CEO) | 2020 |
| B&B Welding | Fort Howard MD | Dennis McCartney | 2018 |
| Consolidated Steel | Pounding Mill VA | Scott Matney (VP Ops) | 2019 |
| Industrial Alloy Welding | Norfolk VA | Mike Robinson | 2017 |
| East Coast Steel Fab | Sinking Springs PA | Mark Maschek | 2017 |

## EDA report data (saved locally)
- **Full raw report:** `.scripts/customer-intel/eda-data/plasma-eda-report-2026-06-26.json` - all 2,000 plasma assets across every account (UCC-1 EDA / asset records).
- **Filtered fab shops:** `.scripts/customer-intel/eda-data/fab-shops-2017-2020-plasma.csv` - 102 mid-size fab shops with industrial plasma tables installed 2017-2020 (nationwide; the 23 above are the Mid-Atlantic subset with contacts on file). Use this CSV to expand outreach to other regions later.
