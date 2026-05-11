const fs = require('fs/promises');
const path = require('path');
const readline = require('readline');
const { chromium } = require('@playwright/test');

const DEFAULT_BASE_URL = 'http://localhost:4173/index.html';
const DEFAULT_PROFILES = {
  free: {
    label: 'Free user A',
    output: '03-tests/.auth/free-user.json'
  },
  'free-b': {
    label: 'Free user B',
    output: '03-tests/.auth/free-user-b.json'
  },
  premium: {
    label: 'Premium/manual-active user',
    output: '03-tests/.auth/premium-user.json'
  }
};

function usage() {
  return [
    '',
    'Usage:',
    '  node 05-tools/scripts/save-playwright-storage-state.js all [base-url]',
    '  node 05-tools/scripts/save-playwright-storage-state.js free [base-url]',
    '  node 05-tools/scripts/save-playwright-storage-state.js free-b [base-url]',
    '  node 05-tools/scripts/save-playwright-storage-state.js premium [base-url]',
    '',
    'Outputs:',
    '  free     -> 03-tests/.auth/free-user.json',
    '  free-b   -> 03-tests/.auth/free-user-b.json',
    '  premium  -> 03-tests/.auth/premium-user.json',
    '',
    'The script opens Chromium. Sign in manually in the opened browser window,',
    'then return to this terminal and press ENTER. Passwords are never stored in code.',
    ''
  ].join('\n');
}

function resolveRunPlan() {
  const profileArg = process.argv[2] || 'all';
  const baseUrl = process.argv[3] || process.env.BARK_E2E_BASE_URL || DEFAULT_BASE_URL;

  if (profileArg === '--help' || profileArg === '-h') {
    console.log(usage());
    process.exit(0);
  }

  const selected = profileArg === 'all'
    ? ['free', 'free-b', 'premium']
    : [profileArg];

  const profiles = selected.map((key) => {
    const profile = DEFAULT_PROFILES[key];
    if (!profile) {
      throw new Error(`Unknown profile "${key}".${usage()}`);
    }
    return { key, ...profile };
  });

  try {
    new URL(baseUrl);
  } catch (error) {
    throw new Error(`Base URL must be an absolute URL. Received: ${baseUrl}`);
  }

  return { baseUrl, profiles };
}

function createPrompt() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return {
    ask(question) {
      return new Promise((resolve) => rl.question(question, resolve));
    },
    close() {
      rl.close();
    }
  };
}

async function waitForCurrentUser(page) {
  const handle = await page.waitForFunction(() => {
    const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
    return user ? {
      uid: user.uid,
      email: user.email || null
    } : null;
  }, undefined, { timeout: 300000 });

  return handle.jsonValue();
}

async function waitForPremiumActive(page) {
  const handle = await page.waitForFunction(() => {
    const premiumService = window.BARK && window.BARK.services && window.BARK.services.premium;
    const isPremium = premiumService && typeof premiumService.isPremium === 'function'
      ? premiumService.isPremium()
      : false;
    const profileText = document.getElementById('profile-premium-status')?.textContent || '';
    const accountText = document.getElementById('account-display-premium')?.textContent || '';

    if (!isPremium) return null;
    if (!/premium active/i.test(profileText) && !/premium/i.test(accountText)) return null;

    return {
      isPremium,
      profileText,
      accountText
    };
  }, undefined, { timeout: 45000 });

  return handle.jsonValue();
}

async function getPremiumDiagnostic(page) {
  return page.evaluate(() => {
    const premiumService = window.BARK && window.BARK.services && window.BARK.services.premium;
    const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
    const entitlement = premiumService && typeof premiumService.getEntitlement === 'function'
      ? premiumService.getEntitlement()
      : null;
    const isPremium = premiumService && typeof premiumService.isPremium === 'function'
      ? premiumService.isPremium()
      : null;

    return {
      uid: user ? user.uid : null,
      email: user ? user.email || null : null,
      isPremium,
      entitlement,
      profileText: document.getElementById('profile-premium-status')?.textContent || null,
      accountText: document.getElementById('account-display-premium')?.textContent || null
    };
  });
}

async function saveStorageState(context, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  try {
    await context.storageState({ path: outputPath, indexedDB: true });
    return 'with IndexedDB';
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (!/indexedDB|unknown option|unexpected option/i.test(message)) throw error;
    await context.storageState({ path: outputPath });
    return 'without IndexedDB';
  }
}

async function captureProfile(browser, prompt, baseUrl, profile) {
  const outputPath = path.resolve(profile.output);
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('');
  console.log('====================================================');
  console.log(`Storage profile: ${profile.label}`);
  console.log(`URL: ${baseUrl}`);
  console.log(`Output: ${outputPath}`);
  console.log('====================================================');
  console.log('1. Sign in manually in the opened Chromium window.');
  console.log('2. Wait until the app clearly shows the correct account.');
  if (profile.key === 'premium') {
    console.log('   Premium profile check: wait until the UI says Premium active before continuing.');
  }
  console.log('3. Return here and press ENTER.');
  console.log('');

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await prompt.ask(`Press ENTER after ${profile.label} is signed in...`);

    const user = await waitForCurrentUser(page);
    console.log(`Detected Firebase currentUser: ${user.email || '(no email)'}; uid=${user.uid}`);

    if (profile.key === 'premium') {
      try {
        const premium = await waitForPremiumActive(page);
        console.log(`Verified premium UI before saving: ${premium.profileText || premium.accountText}`);
      } catch (error) {
        const diagnostic = await getPremiumDiagnostic(page);
        console.error('Premium account did not show Premium active before timeout. Storage state was not saved.');
        console.error(JSON.stringify(diagnostic, null, 2));
        throw error;
      }
    }

    const mode = await saveStorageState(context, outputPath);
    console.log(`Saved ${profile.label} storage state ${mode}: ${outputPath}`);
  } finally {
    await context.close();
  }
}

(async () => {
  const { baseUrl, profiles } = resolveRunPlan();
  const browser = await chromium.launch({ headless: false });
  const prompt = createPrompt();

  try {
    for (const profile of profiles) {
      await captureProfile(browser, prompt, baseUrl, profile);
    }

    console.log('');
    console.log('Done. Run signed-in tests with:');
    console.log(`  export BARK_E2E_BASE_URL=${baseUrl}`);
    console.log('  export BARK_E2E_STORAGE_STATE="$PWD/03-tests/.auth/free-user.json"');
    console.log('  export BARK_E2E_STORAGE_STATE_B="$PWD/03-tests/.auth/free-user-b.json"');
    console.log('  export BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/03-tests/.auth/premium-user.json"');
  } finally {
    prompt.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
