import { afterEach, describe, expect, it } from 'vitest';
import { expectedToken, isAccessEnabled, tokenForPassword } from './access';

const ORIGINAL = process.env.APP_ACCESS_PASSWORD;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.APP_ACCESS_PASSWORD;
  else process.env.APP_ACCESS_PASSWORD = ORIGINAL;
});

describe('access gate', () => {
  it('isAccessEnabled reflects the env var', () => {
    delete process.env.APP_ACCESS_PASSWORD;
    expect(isAccessEnabled()).toBe(false);
    process.env.APP_ACCESS_PASSWORD = 'hunter2';
    expect(isAccessEnabled()).toBe(true);
  });

  it('tokenForPassword is deterministic and password-specific', async () => {
    const a = await tokenForPassword('hunter2');
    const b = await tokenForPassword('hunter2');
    const c = await tokenForPassword('different');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha-256 hex
  });

  it('expectedToken matches tokenForPassword for the configured password', async () => {
    process.env.APP_ACCESS_PASSWORD = 'secret';
    expect(await expectedToken()).toBe(await tokenForPassword('secret'));
  });

  it('expectedToken is null when the gate is disabled', async () => {
    delete process.env.APP_ACCESS_PASSWORD;
    expect(await expectedToken()).toBeNull();
  });
});
