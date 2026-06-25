#!/usr/bin/env node

/**
 * Test script for email-triage worker
 * Run: node test.js
 */

const API_BASE = process.env.WORKER_URL || "http://localhost:8787";
const MCP_SECRET = process.env.MCP_SECRET || "test-secret";

const testCases = [
  {
    name: "Urgent email — production issue",
    email: {
      from: "oncall@example.com",
      to: "eng-team@example.com",
      subject: "CRITICAL: Production database down",
      body: "Our main database is down. All transactions failing. Immediate action required.",
    },
    expectedCategory: "urgent",
  },
  {
    name: "Follow-up email — decision needed",
    email: {
      from: "manager@example.com",
      to: "you@example.com",
      subject: "Q3 roadmap review — need your input",
      body: "Can you review the attached Q3 roadmap and provide feedback by EOD? We need to finalize priorities.",
    },
    expectedCategory: "follow_up",
  },
  {
    name: "FYI email — announcement",
    email: {
      from: "news@example.com",
      to: "all@example.com",
      subject: "New office holiday schedule",
      body: "Please see attached for the updated 2026 holiday schedule. All offices closed on these dates.",
    },
    expectedCategory: "fyi",
  },
  {
    name: "Ignore email — newsletter",
    email: {
      from: "newsletter@tech-news.com",
      to: "you@example.com",
      subject: "Weekly Tech News Digest",
      body: "This week in tech: New AI models, framework updates, industry news. Read more on our site.",
    },
    expectedCategory: "ignore",
  },
];

async function testHealthCheck() {
  console.log("\n📋 Testing health check...");
  const response = await fetch(`${API_BASE}/`);
  if (response.status === 200) {
    const data = await response.json();
    console.log("✅ Health check passed");
    console.log(`   Categories:`, Object.keys(data.categories).join(", "));
  } else {
    console.log(`❌ Health check failed: ${response.status}`);
    return false;
  }
  return true;
}

async function testEmailTriage(testCase) {
  console.log(`\n📧 Testing: ${testCase.name}`);

  const response = await fetch(`${API_BASE}/ingest-email`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${MCP_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(testCase.email),
  });

  if (response.status !== 200) {
    console.log(`❌ Request failed: ${response.status}`);
    const error = await response.json();
    console.log(`   Error: ${error.error || error.message}`);
    return false;
  }

  const result = await response.json();
  const category = result.classification.category;
  const confidence = (result.classification.confidence * 100).toFixed(1);

  const isCorrect = category === testCase.expectedCategory;
  const icon = isCorrect ? "✅" : "⚠️";

  console.log(`${icon} Classification: ${category} (${confidence}% confidence)`);
  console.log(`   Reasoning: ${result.classification.reasoning}`);

  if (!isCorrect) {
    console.log(`   ⚠️ Expected: ${testCase.expectedCategory}`);
  }

  return isCorrect;
}

async function runTests() {
  console.log("🧪 Email Triage Worker Test Suite");
  console.log(`   API: ${API_BASE}`);
  console.log(`   Auth: Bearer ${MCP_SECRET.slice(0, 8)}...`);

  const healthOk = await testHealthCheck();
  if (!healthOk) {
    console.log("\n❌ Worker not responding. Is it running?");
    console.log("   Run: wrangler dev");
    process.exit(1);
  }

  let passed = 0;
  let total = testCases.length;

  for (const testCase of testCases) {
    try {
      const result = await testEmailTriage(testCase);
      if (result) passed++;
    } catch (error) {
      console.log(`❌ Test error: ${error.message}`);
    }
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`📊 Results: ${passed}/${total} tests passed`);

  if (passed === total) {
    console.log("✅ All tests passed!");
  } else {
    console.log(`⚠️ ${total - passed} test(s) may need review`);
  }
}

// Run tests
runTests().catch(console.error);
