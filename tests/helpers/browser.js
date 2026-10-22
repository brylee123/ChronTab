import { chromium } from 'playwright';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { findBrowserExecutable } from '../../scripts/lib/browser-path.js';

export async function launchExtension(options = {}) {
  await mkdir('artifacts', { recursive: true });
  const temporaryRoot = resolve(tmpdir());
  const profile = await mkdtemp(join(temporaryRoot, 'chrontab-browser-'));
  const executablePath =
    process.env.CHRONTAB_BROWSER ||
    (process.platform === 'win32' ? findBrowserExecutable({ preferEdge: true }) : undefined);
  const extensionRoot = resolve('dist');

  async function removeProfile() {
    if (dirname(profile) !== temporaryRoot || !basename(profile).startsWith('chrontab-browser-')) {
      throw new Error('Refusing to remove an unexpected browser profile path.');
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      ...(executablePath ? { executablePath } : { channel: 'chromium' }),
      headless: true,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      args: [
        '--disable-extensions-except=' + extensionRoot,
        '--load-extension=' + extensionRoot,
        '--no-first-run',
      ],
      ...options,
    });
  } catch (error) {
    await removeProfile();
    throw error;
  }

  return {
    context,
    async dispose() {
      try {
        await context.close();
      } finally {
        await removeProfile();
      }
    },
  };
}

// Moveable fixtures keep browser tests valid after the current calendar year.
export function futureCalendarFixture() {
  const year = new Date().getFullYear() + 1;
  const firstMonday = 1 + ((8 - new Date(year, 0, 1).getDay()) % 7);
  const holidayDay = firstMonday + 14; // Martin Luther King Jr. Day, third Monday.
  const january = (day) => year + '-01-' + String(day).padStart(2, '0');
  return {
    year,
    holidayDay,
    holiday: january(holidayDay),
    firstWorkday: january(holidayDay + 1),
    timeOff: january(holidayDay + 3),
    monthLabel: 'January ' + year,
  };
}
