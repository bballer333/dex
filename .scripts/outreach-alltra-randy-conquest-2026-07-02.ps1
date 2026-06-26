# ALLtra / Randy CONQUEST outreach - Thursday, July 2, 2026
# Mid-Atlantic (PA/NJ/DE/MD/VA) fabrication shops running competitor plasma tables installed 2017-2020 (UCC-1 EDA report).
# Cold-ish outreach: get them in front of Randy (ALLtra) while he's in the region.
# Generated 2026-06-26. Contacts/decision-makers pulled from Salesforce.
#
# HOW TO RUN (classic Outlook open, normal PowerShell - NOT admin):
#   . "c:\Users\Chris\Documents\GitHub\dex\.scripts\outreach-alltra-randy-conquest-2026-07-02.ps1"
#
# NOTE: These shops span PA->VA. Randy can't hit them all in one day - this seeds interest;
# route confirmed responders into his Thursday 7/2 itinerary by cluster.

$outlook = New-Object -ComObject Outlook.Application

$emails = @(
    @{  # JR Metal Products LLC - Leola PA - plasma 2019
        To="john@jrmetalproducts.com"; Subject="ALLtra in the Area Thursday 7/2 - Plasma Cutting"
        Body="Hi John,`n`nChris Barsanti with Mid Atlantic Machinery. The plasma table you put in back in 2019 is getting some hours on it, and I've got Randy from ALLtra doing shop visits in the region this Thursday, July 2.`n`nALLtra builds a heavy-duty unitized plasma that a lot of PA fab shops have moved to - cut quality, speed, and uptime. No pressure at all, but if you'd be open to a 20-minute look (or sample parts), I can route Randy your way. Worth a quick conversation?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # K-Fab Inc - Berwick PA - plasma 2018
        To="rbarnes@kfabinc.com"; Subject="Plasma Cutting - ALLtra Rep in the Region 7/2"
        Body="Hi Randy,`n`nChris Barsanti, Mid Atlantic Machinery. With your plasma now a few years in (2018), I wanted to put something on your radar: Randy from ALLtra will be making shop visits in the area Thursday, July 2.`n`nALLtra's unitized tables have become a go-to for fab shops looking to step up cut quality and throughput. Happy to bring him by for a no-pressure look if you're interested. Want me to set aside some time?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # E & E Metal Fab Inc - Lebanon PA - plasma 2017
        To="willie@e-emetalfab.com"; Subject="ALLtra Plasma - Rep in the Area Thursday 7/2"
        Body="Hi Willie,`n`nChris Barsanti with Mid Atlantic Machinery. Your plasma table dates to 2017, so it's a good time to see how far the technology has come. Randy from ALLtra is doing regional shop visits this Thursday, July 2.`n`nALLtra builds a rugged unitized plasma - strong on cut quality, speed, and uptime. If you're open to a quick look or some cut samples, I can get Randy in front of you. Worth 20 minutes?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # Ebinger Iron Works Inc. - Schuylkill Haven PA - plasma 2020
        To="wlm@ebingeriron.com"; Subject="ALLtra Plasma - In the Area Thursday 7/2"
        Body="Hi Bill,`n`nChris Barsanti, Mid Atlantic Machinery. I know your plasma is relatively recent (2020), but I wanted to reach out anyway - Randy from ALLtra will be in the region Thursday, July 2, and it's a good chance to see where ALLtra's tables stand if you're ever weighing a second machine or added capacity.`n`nNo pressure - just happy to introduce you while he's local. Want me to hold a slot?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # Rearden Steel Fabrication, Inc. - Lemoyne PA - plasma 2018
        To="scapuano@reardensteelfab.com"; Subject="Plasma Cutting - ALLtra Rep Local Thursday 7/2"
        Body="Hi Steve,`n`nChris Barsanti with Mid Atlantic Machinery. Your plasma is a few years in now (2018), and I've got Randy from ALLtra making shop visits in the area Thursday, July 2.`n`nALLtra's unitized plasma has been a strong move for steel fabricators on cut quality and uptime. If you'd be open to a short look or sample parts, I'll route him your way. Worth a quick chat?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # Lingis Mfg & Machine Co - Sycamore PA - plasma 2018
        To="greg@lingismfg.com"; Subject="ALLtra Plasma - Rep in the Region 7/2"
        Body="Hi Greg,`n`nChris Barsanti, Mid Atlantic Machinery. With your plasma table now a few years old (2018), I wanted to flag that Randy from ALLtra is doing regional shop visits Thursday, July 2.`n`nALLtra builds a heavy-duty unitized plasma a lot of shops have stepped up to. No pressure - if a 20-minute look or cut samples would be useful, I can bring him by. Interested?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # Metal Stock, Inc. - Philadelphia PA - plasma 2018
        To="tyler@metal-stock.com"; Subject="Plasma Cutting - ALLtra in the Area Thursday 7/2"
        Body="Hi Tyler,`n`nChris Barsanti with Mid Atlantic Machinery. Your plasma dates to 2018, so it's a good time to benchmark against current tech. Randy from ALLtra will be making shop visits in the area Thursday, July 2.`n`nALLtra's unitized tables are strong on speed, cut quality, and uptime. If you're open to a quick look, I'll get him in front of you. Worth setting up?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # Integrated Fabrication & Machine, Inc - Greenville PA - plasma 2019
        To="jebraymer@integratedfab.com"; Subject="ALLtra Plasma - Rep Local Thursday 7/2"
        Body="Hi Jim,`n`nChris Barsanti, Mid Atlantic Machinery. Your plasma is a few years in (2019), and Randy from ALLtra is doing regional shop visits Thursday, July 2.`n`nALLtra's unitized plasma has been a strong play for fab and machine shops. If a no-pressure look or some sample cuts would help, I'll route him your way. Open to it?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # Kelly Iron Works, Inc. - Hazleton PA - plasma 2020
        To="pfk@kellyiron.com"; Subject="ALLtra Plasma - In the Area Thursday 7/2"
        Body="Hi Padraig,`n`nChris Barsanti with Mid Atlantic Machinery. Your plasma is fairly recent (2020), but Randy from ALLtra will be in the Hazleton area Thursday, July 2, and I wanted to make the introduction while he's local - useful if you ever look at a second table or more capacity.`n`nNo pressure at all. Want me to hold a few minutes?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # Hazleton Iron, LLC - Hazleton PA - plasma 2019
        To="rkrobert@hazletoniron.com"; Subject="ALLtra Plasma - Rep in Hazleton Thursday 7/2"
        Body="Hi Russ,`n`nChris Barsanti, Mid Atlantic Machinery. Your plasma table is a few years in now (2019), and Randy from ALLtra will be right in the Hazleton area Thursday, July 2.`n`nALLtra builds a rugged unitized plasma - worth a look on cut quality and uptime. If you're open to a quick visit or sample parts, I'll bring him by. Worth 20 minutes?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # Contrast Metalworks LLC - Pottstown PA - plasma 2018
        To="contrastmetalworksllc@gmail.com"; Subject="Plasma Cutting - ALLtra Rep in the Area 7/2"
        Body="Hi Greg,`n`nChris Barsanti with Mid Atlantic Machinery. With your plasma a few years in (2018), I wanted to flag that Randy from ALLtra is doing shop visits in the region Thursday, July 2.`n`nALLtra's unitized tables have been a strong step up for metalworks shops. No pressure - if a short look or cut samples would be useful, I can route him your way. Interested?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # Michelman Steel Enterprises - Bethlehem PA - plasma 2017
        To="emichelman@michelmansteel.com"; Subject="ALLtra Plasma - Rep in the Area Thursday 7/2"
        Body="Hi Eric,`n`nChris Barsanti, Mid Atlantic Machinery. Your plasma dates to 2017, so it's a good time to see how the technology's moved. Randy from ALLtra will be making shop visits in the Lehigh Valley area Thursday, July 2.`n`nALLtra's unitized plasma is strong on speed, cut quality, and uptime. Happy to bring him by for a no-pressure look or sample parts. Worth a quick conversation?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # Alessandra Misc. Metals Works Inc - Newton NJ - plasma 2019
        To="derek@alessandramisc.com"; Subject="ALLtra Plasma - Rep in the Region Thursday 7/2"
        Body="Hi Derek,`n`nChris Barsanti with Mid Atlantic Machinery. Your plasma is a few years in now (2019), and Randy from ALLtra is doing regional shop visits Thursday, July 2.`n`nALLtra builds a heavy-duty unitized plasma a lot of metal shops have moved to. If you'd be open to a quick look or some cut samples, I'll route him your way. Worth setting up?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # Eastern Shore Metals LLC - Seaford DE - plasma 2019
        To="cmarvel@easternshoremetals.com"; Subject="ALLtra Plasma - Rep on the Shore Thursday 7/2"
        Body="Hi Chris,`n`nChris Barsanti, Mid Atlantic Machinery. Your plasma table is a few years in (2019), and Randy from ALLtra will be in the Delmarva area Thursday, July 2.`n`nALLtra's unitized plasma is worth a look on cut quality and uptime. No pressure - if a short visit or sample cuts would help, I'll bring him by. Open to it?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # Crystal Steel Fabricators Inc - Delmar DE - plasma 2019
        To="mmishler@crystalsteel.net"; Subject="ALLtra Plasma - Rep in Delmar Area Thursday 7/2"
        Body="Hi Mike,`n`nChris Barsanti with Mid Atlantic Machinery. With your plasma a few years in (2019), I wanted to flag that Randy from ALLtra will be in the Delmar area Thursday, July 2.`n`nALLtra builds a rugged unitized plasma that's been a strong move for steel fabricators on throughput and uptime. Happy to bring him by for a no-pressure look or sample parts. Worth 20 minutes?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # Amazon Steel Construction - Milford DE - plasma 2017
        To="mheesh@amazonsteelconstruction.com"; Subject="ALLtra Plasma - Rep in the Area Thursday 7/2"
        Body="Hi Martin,`n`nChris Barsanti, Mid Atlantic Machinery. Your plasma dates to 2017, so it's a good time to benchmark against current tech. Randy from ALLtra will be in the Milford area Thursday, July 2.`n`nALLtra's unitized plasma is strong on cut quality, speed, and uptime. If you're open to a quick look or cut samples, I'll route him your way. Worth a conversation?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # Miscellaneous Metals, Inc - Walkersville MD - plasma 2018
        To="mkissner@miscmet.com"; Subject="ALLtra Plasma - Rep in the Region Thursday 7/2"
        Body="Hi Mark,`n`nChris Barsanti with Mid Atlantic Machinery. Your plasma is a few years in now (2018), and Randy from ALLtra is doing shop visits in the area Thursday, July 2.`n`nALLtra's unitized tables have been a strong step up for metal shops on speed and cut quality. No pressure - if a short look or sample parts would be useful, I'll bring him by. Interested?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # Reedbird Steel LLC - Odenton MD - plasma 2019
        To="steve@reedbirdsteel.com"; Subject="ALLtra Plasma - Rep in the Area Thursday 7/2"
        Body="Hi Steve,`n`nChris Barsanti, Mid Atlantic Machinery. Your plasma table is a few years in (2019), and Randy from ALLtra will be making shop visits in the area Thursday, July 2.`n`nALLtra builds a heavy-duty unitized plasma worth a look on cut quality and uptime. Happy to bring him by for a no-pressure look or some sample cuts. Worth setting up?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # Patriot Steel Fabrication, Inc. - Church Creek MD - plasma 2020
        To="nathan@patriotsteelfab.com"; Subject="ALLtra Plasma - In the Area Thursday 7/2"
        Body="Hi Nathan,`n`nChris Barsanti with Mid Atlantic Machinery. Your plasma is fairly recent (2020), but Randy from ALLtra will be in the area Thursday, July 2, and I wanted to make the introduction while he's local - handy if you ever look at added capacity or a second table.`n`nNo pressure at all. Want me to hold a few minutes?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # B&B Welding Co, Inc - Fort Howard MD - plasma 2018
        To="dennis@bandbwelding.com"; Subject="ALLtra Plasma - Rep in the Area Thursday 7/2"
        Body="Hi Dennis,`n`nChris Barsanti, Mid Atlantic Machinery. With your plasma a few years in (2018), I wanted to flag that Randy from ALLtra is doing shop visits in the area Thursday, July 2.`n`nALLtra's unitized plasma is a strong play on cut quality and uptime. If a quick look or sample parts would help, I'll route him your way. Worth a chat?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # Consolidated Steel, Inc. - Pounding Mill VA - plasma 2019
        To="smatney@consolidatedsteelinc.com"; Subject="ALLtra Plasma - Rep in the Region Thursday 7/2"
        Body="Hi Scott,`n`nChris Barsanti with Mid Atlantic Machinery. Your plasma is a few years in now (2019), and Randy from ALLtra is doing regional shop visits Thursday, July 2.`n`nALLtra builds a rugged unitized plasma a lot of steel fabricators have stepped up to on throughput and uptime. No pressure - if a look or sample cuts would be useful, I'll route him your way. Open to it?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # Industrial Alloy Welding - Norfolk VA - plasma 2017
        To="mike@iawelding.com"; Subject="ALLtra Plasma - Rep in the Area Thursday 7/2"
        Body="Hi Mike,`n`nChris Barsanti, Mid Atlantic Machinery. Your plasma dates to 2017, so it's a good time to see how far the tech has come. Randy from ALLtra will be in the area Thursday, July 2.`n`nALLtra's unitized plasma is strong on cut quality, speed, and uptime. If you're open to a quick look or sample parts, I'll get him in front of you. Worth 20 minutes?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    },
    @{  # East Coast Steel Fab - Sinking Springs PA - plasma 2017
        To="mmaschek@eastcoaststeelfab.com"; Subject="ALLtra Plasma - Rep in the Area Thursday 7/2"
        Body="Hi Mark,`n`nChris Barsanti with Mid Atlantic Machinery. Your plasma dates to 2017, so it's a good time to benchmark against current tech. Randy from ALLtra will be making shop visits in the area Thursday, July 2.`n`nALLtra's unitized plasma is a strong step up on speed and cut quality. Happy to bring him by for a no-pressure look or some cut samples. Worth a conversation?`n`nThanks,`nChris Barsanti`nMid Atlantic Machinery"
    }
)

$created = 0
$skipped = 0

foreach ($email in $emails) {
    try {
        $mail = $outlook.CreateItem(0)
        $mail.To = $email.To
        if ($email.CC) { $mail.CC = $email.CC }
        $mail.Subject = $email.Subject
        $mail.Body = $email.Body
        $mail.Save()
        Write-Host "OK: $($email.To) - $($email.Subject)" -ForegroundColor Green
        $created++
    } catch {
        Write-Host "FAIL: $($email.To) - $_" -ForegroundColor Red
        $skipped++
    }
}

Write-Host ""
Write-Host "Done: $created conquest drafts created, $skipped failed." -ForegroundColor Cyan
