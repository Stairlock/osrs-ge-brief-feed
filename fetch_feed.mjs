// Builds feed/latest.json for the OSRS daily brief cloud agent.
// Runs in a GitHub Action (open internet); pulls ONLY public endpoints, no secrets.
// The cloud agent (which has no internet) clones this repo and reads the JSON.
import { writeFile } from 'node:fs/promises';

const SUPABASE_URL = 'https://jxzyqzhnttacaibuwkgo.supabase.co';
// public anon key — ships in the web client bundle, safe to embed
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4enlxemhudHRhY2FpYnV3a2dvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNTA0OTgsImV4cCI6MjA5ODYyNjQ5OH0.Op1e44MyEUsnYLMo-H72MZj-xrm75yn3BpKPbKcWm_8';
const UA = 'osrs-ge-brief-bot/1.0 (github action; contact spargo.jayden@gmail.com)';

async function safe(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(`[${label}] failed:`, e.message);
    return { error: e.message };
  }
}

// Our model's current candidates (reversion + churn) via the public RPC.
function getOpportunities() {
  return safe('opportunities', async () => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/daily_opportunities`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  });
}

// Official Old School RuneScape news RSS.
function getOfficialNews() {
  return safe('official-news', async () => {
    const r = await fetch('https://secure.runescape.com/m=news/latest_news.rss?oldschool=1', {
      headers: { 'User-Agent': UA },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const xml = await r.text();
    const items = [];
    const strip = (s) =>
      (s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
    const pick = (block, tag) => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
      return m ? strip(m[1]) : null;
    };
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(xml)) && items.length < 15) {
      items.push({
        title: pick(m[1], 'title'),
        date: pick(m[1], 'pubDate'),
        link: pick(m[1], 'link'),
        summary: (pick(m[1], 'description') || '').slice(0, 400),
      });
    }
    if (items.length === 0) throw new Error('no items parsed');
    return items;
  });
}

// Hot posts from a subreddit via the public Atom (.rss) endpoint. Reddit blocks
// the JSON API for non-OAuth/datacenter requests (403), but .rss is permissive.
// Best-effort — if it fails, the cloud agent falls back to WebSearch for Reddit.
function getSubreddit(sub) {
  return safe(`reddit/${sub}`, async () => {
    let r;
    for (let attempt = 0; attempt < 3; attempt++) {
      r = await fetch(`https://www.reddit.com/r/${sub}/hot.rss?limit=25`, { headers: { 'User-Agent': UA } });
      if (r.ok) break;
      if (r.status === 429) await new Promise((res) => setTimeout(res, 5000 * (attempt + 1)));
      else break;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const xml = await r.text();
    const strip = (s) =>
      (s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const grab = (b, re) => {
      const m = b.match(re);
      return m ? m[1] : null;
    };
    const entries = [];
    const re = /<entry>([\s\S]*?)<\/entry>/g;
    let m;
    while ((m = re.exec(xml)) && entries.length < 15) {
      const b = m[1];
      entries.push({
        title: strip(grab(b, /<title>([\s\S]*?)<\/title>/)),
        url: grab(b, /<link[^>]*href="([^"]+)"/),
        updated: grab(b, /<updated>([\s\S]*?)<\/updated>/),
        snippet: strip(grab(b, /<content[^>]*>([\s\S]*?)<\/content>/)).slice(0, 300),
      });
    }
    if (entries.length === 0) throw new Error('no entries parsed');
    return entries;
  });
}

const opportunities = await getOpportunities();
const official = await getOfficialNews();
// sequential + spaced so Reddit doesn't rate-limit (429) the run
const reddit = {};
for (const sub of ['2007scape', 'osrs', 'OSRSflipping']) {
  reddit[sub] = await getSubreddit(sub);
  await new Promise((res) => setTimeout(res, 2000));
}
const [r2007] = [reddit['2007scape']];

const feed = {
  generated_at: new Date().toISOString(),
  note:
    'Public feed for the OSRS daily investment brief. opportunities = our GE-tracker model output; news = official OSRS RSS; reddit = hot posts from the three subs. Any field may contain {error} if that source was unreachable this run.',
  opportunities,
  news: { official, reddit },
};

await writeFile('feed/latest.json', JSON.stringify(feed, null, 2));
console.log(
  `wrote feed/latest.json — opportunities:${opportunities?.reversion?.length ?? 'err'} rev / ${opportunities?.churn?.length ?? 'err'} churn, official:${Array.isArray(official) ? official.length : 'err'}, reddit 2007scape:${Array.isArray(r2007) ? r2007.length : 'err'}`
);
