#!/usr/bin/env node
// Pulls cost/usage data from Vercel, Supabase, OpenRouter, and Fly.io
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dir, '../.env'), 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.split('=').reduce((a, v, i) => i === 0 ? [v] : [a[0], (a[1]||'') + (i>1?'=':'') + v], []))
    .filter(([k]) => k)
);

const FLY_TOKEN = env.FLY_API_TOKEN;
const VERCEL_TOKEN = env.VERCEL_TOKEN;
const OPENROUTER_KEY = env.OPENROUTER;
const SUPABASE_PAT = env.SUPABASE_PAT || '';

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, opts);
  return res.json();
}

async function openrouter() {
  const data = await fetchJSON('https://openrouter.ai/api/v1/auth/key', {
    headers: { Authorization: `Bearer ${OPENROUTER_KEY}` }
  });
  const d = data.data || data;
  return {
    label: 'OpenRouter',
    plan: d.is_free_tier ? 'free tier' : 'paid',
    spend: {
      daily: d.usage_daily,
      weekly: d.usage_weekly,
      monthly: d.usage_monthly,
      total: d.usage,
      limit: d.limit,
      remaining: d.limit_remaining,
    },
    currency: 'USD',
  };
}

async function fly() {
  const gql = async (query) => {
    const r = await fetchJSON('https://api.fly.io/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${FLY_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    return r.data;
  };

  const data = await gql(`{
    organization(slug:"personal") {
      apps { nodes { name machines { nodes { id state } } } }
    }
  }`);

  const apps = data?.organization?.apps?.nodes || [];
  const machines = apps.flatMap(a => a.machines?.nodes || []);
  const byState = machines.reduce((acc, m) => {
    acc[m.state] = (acc[m.state] || 0) + 1;
    return acc;
  }, {});

  // Fly pricing: shared-cpu-1x @ 256MB = ~$2.24/mo running, $0.00 suspended
  // Approximate: $0.0000008/second/machine when started
  const runningCount = byState.started || 0;
  const estimatedHourlyCost = runningCount * 0.00031; // ~$0.224/mo per machine = $0.00031/hr

  return {
    label: 'Fly.io',
    plan: 'pay-as-you-go',
    apps: apps.length,
    machines: { total: machines.length, byState },
    estimatedHourlyCost,
    note: 'Cost estimate based on shared-cpu-1x pricing; see fly.io/organizations/personal/billing for actuals',
    currency: 'USD',
  };
}

async function vercel() {
  const TEAM_ID = 'team_1tOEYeZtDbrRUJLe5HnIzgBX';
  const [team, deployments] = await Promise.all([
    fetchJSON(`https://api.vercel.com/v2/teams/${TEAM_ID}`, {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` }
    }),
    fetchJSON(`https://api.vercel.com/v6/deployments?teamId=${TEAM_ID}&limit=10`, {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` }
    }),
  ]);

  return {
    label: 'Vercel',
    plan: team.billing?.plan || 'hobby',
    billingStatus: team.billing?.status,
    currency: team.billing?.currency || 'usd',
    monthlyCost: team.billing?.plan === 'hobby' ? 0 : null,
    recentDeployments: (deployments.deployments || []).length,
    note: 'Hobby plan is free; Pro plan starts at $20/mo. No usage cost data exposed via API on hobby.',
  };
}

async function supabase() {
  const PAT = SUPABASE_PAT;
  const [projects] = await Promise.all([
    fetchJSON('https://api.supabase.com/v1/projects', {
      headers: { Authorization: `Bearer ${PAT}` }
    }),
  ]);

  const atlasProject = (projects || []).find(p => p.id === 'nsqpzqyykpeqoyokwutb');

  return {
    label: 'Supabase',
    plan: 'free tier',
    project: atlasProject ? {
      name: atlasProject.name,
      status: atlasProject.status,
      region: atlasProject.region,
    } : null,
    monthlyCost: 0,
    note: 'Free plan. Pro plan starts at $25/mo. Billing data not exposed via Management API on free tier.',
    currency: 'USD',
  };
}

const fmt = (n, decimals = 4) => n != null ? `$${Number(n).toFixed(decimals)}` : 'N/A';
const fmtUSD = (n) => n != null ? `$${Number(n).toFixed(2)}` : 'N/A';

async function main() {
  console.log('\n📊 Cost Dashboard\n' + '='.repeat(50));

  const results = await Promise.allSettled([openrouter(), fly(), vercel(), supabase()]);

  for (const r of results) {
    if (r.status === 'rejected') {
      console.error('Error:', r.reason?.message || r.reason);
      continue;
    }
    const d = r.value;
    console.log(`\n▸ ${d.label} (${d.plan})`);

    if (d.label === 'OpenRouter') {
      console.log(`  Monthly spend:  ${fmt(d.spend.monthly)}`);
      console.log(`  Daily spend:    ${fmt(d.spend.daily)}`);
      console.log(`  Total spend:    ${fmt(d.spend.total)}`);
      console.log(`  Limit:          ${fmtUSD(d.spend.limit)}  |  Remaining: ${fmt(d.spend.remaining, 4)}`);
    } else if (d.label === 'Fly.io') {
      console.log(`  Apps: ${d.apps}  |  Machines: ${d.machines.total}`);
      console.log(`  States: ${Object.entries(d.machines.byState).map(([k,v])=>`${k}:${v}`).join(', ')}`);
      console.log(`  Est. hourly cost (${d.machines.byState.started||0} running): ${fmt(d.estimatedHourlyCost, 5)}/hr`);
      console.log(`  ℹ  ${d.note}`);
    } else if (d.label === 'Vercel') {
      console.log(`  Plan: ${d.plan}  |  Status: ${d.billingStatus}`);
      console.log(`  Monthly cost: ${fmtUSD(d.monthlyCost)}`);
      console.log(`  ℹ  ${d.note}`);
    } else if (d.label === 'Supabase') {
      if (d.project) console.log(`  Project: ${d.project.name} (${d.project.status}) @ ${d.project.region}`);
      console.log(`  Monthly cost: ${fmtUSD(d.monthlyCost)}`);
      console.log(`  ℹ  ${d.note}`);
    }
  }

  console.log('\n' + '='.repeat(50));
}

main().catch(console.error);
