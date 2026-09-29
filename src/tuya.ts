// Tuya IoT Cloud client (Garni 419T weather station).

import crypto from 'node:crypto';

export interface TuyaConfig {
  baseUrl: string;
  clientId: string;
  secret: string;
}

export interface TuyaStatus {
  code: string;
  value: unknown;
}

interface TuyaResponse<T> {
  success: boolean;
  code?: number;
  msg?: string;
  result: T;
}

export class Tuya {
  private readonly cfg: TuyaConfig;
  private token: string | null = null;
  private tokenExpires = 0;

  constructor(cfg: TuyaConfig) {
    this.cfg = cfg;
  }

  async request<T>(method: string, path: string, { auth = true } = {}): Promise<T> {
    const { baseUrl, clientId, secret } = this.cfg;
    const t = Date.now().toString();
    const nonce = crypto.randomUUID();
    const bodyHash = crypto.createHash('sha256').update('').digest('hex');
    const stringToSign = [method, bodyHash, '', path].join('\n');
    const accessToken = auth ? await this.getToken() : '';
    const sign = crypto
      .createHmac('sha256', secret)
      .update(clientId + accessToken + t + nonce + stringToSign)
      .digest('hex')
      .toUpperCase();

    const headers: Record<string, string> = { client_id: clientId, sign, t, nonce, sign_method: 'HMAC-SHA256' };
    if (auth) headers.access_token = accessToken;

    const res = await fetch(baseUrl + path, { method, headers });
    const json = (await res.json()) as TuyaResponse<T>;
    if (!json.success) {
      // 1010 = token invalid, 1011 = token expired
      if (auth && [1010, 1011].includes(json.code ?? 0)) this.token = null;
      throw new Error(`Tuya ${path}: ${json.code} ${json.msg}`);
    }
    return json.result;
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpires) return this.token;
    const r = await this.request<{ access_token: string; expire_time: number }>(
      'GET',
      '/v1.0/token?grant_type=1',
      { auth: false },
    );
    this.token = r.access_token;
    this.tokenExpires = Date.now() + (r.expire_time - 120) * 1000;
    return this.token;
  }

  deviceStatus(deviceId: string): Promise<TuyaStatus[]> {
    return this.request('GET', `/v1.0/devices/${deviceId}/status`);
  }

  deviceSpecifications(deviceId: string): Promise<{ status?: { code: string; values: string }[] }> {
    return this.request('GET', `/v1.0/devices/${deviceId}/specifications`);
  }
}
