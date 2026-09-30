// Netatmo client. Logs in with username and password the same way the official app
// does, because the truetemperature endpoint is not part of the public developer API.

import { httpTimeout, log, sleep } from './utils.ts';

export interface NetatmoConfig {
  username: string;
  password: string;
}

export interface HomesData {
  body: {
    homes: {
      id: string;
      name: string;
      rooms?: { id: string; name: string; module_ids?: string[] }[];
    }[];
  };
}

export interface HomeStatus {
  body: {
    home: {
      modules?: { id: string; type: string; boiler_status?: boolean }[];
      rooms?: {
        id: string;
        reachable?: boolean;
        therm_measured_temperature?: number;
        therm_setpoint_temperature?: number;
      }[];
    };
  };
}

interface ApiOptions {
  query?: Record<string, string>;
  json?: unknown;
}

export class Netatmo {
  static readonly AUTH = 'https://auth.netatmo.com';
  static readonly API = 'https://api.netatmo.com';
  static readonly UA = 'netatmo-home';
  static readonly TOKEN_TTL_MS = 2.5 * 3600 * 1000;

  private readonly cfg: NetatmoConfig;
  private readonly cookies = new Map<string, string>();
  private token: string | null = null;
  private tokenTime = 0;

  constructor(cfg: NetatmoConfig) {
    this.cfg = cfg;
  }

  // fetch that follows redirects manually so every Set-Cookie along the way is collected
  private async fetchWithCookies(
    url: string,
    init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {},
  ): Promise<Response> {
    let method = init.method || 'GET';
    let body = init.body;
    for (let i = 0; i < 10; i++) {
      const headers: Record<string, string> = { 'User-Agent': Netatmo.UA, ...init.headers };
      if (this.cookies.size) {
        headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      }
      const res = await fetch(url, { method, headers, body, redirect: 'manual', signal: httpTimeout() });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';');
        const eq = pair.indexOf('=');
        this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        url = new URL(loc, url).toString();
        if (res.status !== 307 && res.status !== 308) {
          method = 'GET';
          body = undefined;
        }
        continue;
      }
      return res;
    }
    throw new Error('Netatmo: too many redirects');
  }

  private async login(): Promise<void> {
    log('Netatmo: logging in…');
    this.cookies.clear();
    await this.fetchWithCookies(`${Netatmo.AUTH}/en-us/access/login`);
    this.cookies.set('netatmocomlast_app_used', 'app_thermostat');

    const csrfRes = await this.fetchWithCookies(`${Netatmo.AUTH}/access/csrf`);
    const { token: csrf } = (await csrfRes.json()) as { token: string };

    await this.fetchWithCookies(`${Netatmo.AUTH}/access/postlogin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        email: this.cfg.username,
        password: this.cfg.password,
        stay_logged: 'on',
        _token: csrf,
      }).toString(),
    });

    await this.fetchWithCookies(
      `${Netatmo.AUTH}/access/keychain?next_url=${encodeURIComponent('https://my.netatmo.com')}`,
    );

    const raw = this.cookies.get('netatmocomaccess_token');
    if (!raw) throw new Error('Netatmo: login failed (no access token – wrong password?)');
    this.token = decodeURIComponent(raw);
    this.tokenTime = Date.now();
    log('Netatmo: logged in');
  }

  private async api<T>(method: string, path: string, { query, json }: ApiOptions = {}, retried = false): Promise<T> {
    if (!this.token || Date.now() - this.tokenTime > Netatmo.TOKEN_TTL_MS) await this.login();
    const url = new URL(Netatmo.API + path);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await fetch(url, {
      method,
      headers: {
        'User-Agent': Netatmo.UA,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: json ? JSON.stringify(json) : undefined,
      signal: httpTimeout(),
    });
    if ((res.status === 401 || res.status === 403) && !retried) {
      this.token = null;
      return this.api(method, path, { query, json }, true);
    }
    // 502/503/504 from their nginx are usually transient – retry once
    if (res.status >= 500 && !retried) {
      log(`Netatmo ${path}: HTTP ${res.status}, retrying in 10 s`);
      await sleep(10_000);
      return this.api(method, path, { query, json }, true);
    }
    const text = await res.text();
    if (!res.ok) {
      const msg = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      throw new Error(`Netatmo ${path}: HTTP ${res.status} ${msg.slice(0, 300)}`);
    }
    const data = (text ? JSON.parse(text) : {}) as { status?: string; error?: unknown };
    // An error can also arrive with HTTP 200; never report it as a successful call
    if (data.error || (data.status !== undefined && data.status !== 'ok')) {
      throw new Error(`Netatmo ${path}: ${text.slice(0, 300)}`);
    }
    return data as T;
  }

  homesData(): Promise<HomesData> {
    return this.api('GET', '/api/homesdata');
  }

  homeStatus(homeId: string): Promise<HomeStatus> {
    return this.api('GET', '/api/homestatus', { query: { home_id: homeId } });
  }

  trueTemperature(homeId: string, roomId: string, current: number, corrected: number): Promise<unknown> {
    return this.api('POST', '/api/truetemperature', {
      json: {
        home_id: homeId,
        room_id: roomId,
        current_temperature: current,
        corrected_temperature: corrected,
      },
    });
  }
}
