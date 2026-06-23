#!/usr/bin/env node
/**
 * Daily Plan Quick Reference Generator
 * Fires on Stop after /daily-plan completes
 * Creates a condensed quickref from the full daily plan
 */
const fs = require('fs');
const path = require('path');

const vaultRoot = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '../..');
const today = new Date().toISOString().split('T')[0];

// Plans are saved to Archive/Plans/YYYY-MM-DD.md
const planPath = path.join(vaultRoot, 'Archive', 'Plans', `${today}.md`);
const quickRefPath = path.join(vaultRoot, 'Inbox', 'Daily_Plans', `${today}-quickref.md`);

// Only run if today's plan exists
if (!fs.existsSync(planPath)) {
  process.exit(0);
}

// Ensure output dir exists
const outDir = path.dirname(quickRefPath);
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const content = fs.readFileSync(planPath, 'utf-8');
const lines = content.split('\n');

let focusItems = [];
let negotiationItems = [];
let headsUp = [];
let doToday = [];
let currentSection = '';

for (const line of lines) {
  const heading = line.match(/^#{1,3}\s+(.+)/);
  if (heading) {
    const h = heading[1].toLowerCase();
    if (h.includes('focus'))        currentSection = 'focus';
    else if (h.includes('negotiation') || h.includes('action required')) currentSection = 'negotiation';
    else if (h.includes('heads up')) currentSection = 'headsup';
    else if (h.includes('do today')) currentSection = 'dotoday';
    else                             currentSection = 'other';
    continue;
  }

  const trimmed = line.trim();
  if (!trimmed || trimmed === '---') continue;

  if (currentSection === 'focus' && trimmed.match(/^\d+\.\s+\[/)) {
    if (focusItems.length < 3) focusItems.push(trimmed.replace(/^\d+\.\s+/, ''));
  }
  if (currentSection === 'negotiation' && trimmed.startsWith('|') && !trimmed.match(/^[|\s-]+$/)) {
    // Table row — skip header/separator rows
    const cells = trimmed.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 2 && !cells[0].match(/^deal$/i)) {
      if (negotiationItems.length < 3) negotiationItems.push(`- ${cells[0]} — ${cells[1]}`);
    }
  }
  if (currentSection === 'headsup' && trimmed.startsWith('-')) {
    if (headsUp.length < 3) headsUp.push(trimmed);
  }
  if (currentSection === 'dotoday' && trimmed.startsWith('- [')) {
    if (doToday.length < 5) doToday.push(trimmed);
  }
}

const quickRef = [
  `# Quick Ref — ${today}`,
  '',
  '## 🎯 Top 3 Focus',
  ...(focusItems.length > 0 ? focusItems.map(f => `- ${f}`) : ['- See full plan']),
  '',
  '## ⚠️ Negotiation',
  ...(negotiationItems.length > 0 ? negotiationItems : ['- None flagged']),
  '',
  '## ✅ Do Today',
  ...(doToday.length > 0 ? doToday : ['- See full plan']),
  '',
  '## ⚠️ Heads Up',
  ...(headsUp.length > 0 ? headsUp : ['- None']),
  '',
  '---',
  `*Full plan: [[${today}]]*`,
].join('\n');

fs.writeFileSync(quickRefPath, quickRef);
console.log(`Quick ref → ${quickRefPath}`);
