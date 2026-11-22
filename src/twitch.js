/**
 * Client minimal de l'API Twitch Helix (authentification "client credentials").
 */
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const API = 'https://api.twitch.tv/helix';

class TwitchClient {
  constructor(clientId, clientSecret) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  async getToken() {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'client_credentials',
    });
    const res = await fetch(TOKEN_URL, { method: 'POST', body });
    if (!res.ok) throw new Error(`Twitch auth ${res.status}: ${await res.text()}`);
    const data = await res.json();
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return this.token;
  }

  async get(path, params) {
    const url = `${API}/${path}?${new URLSearchParams(params)}`;
    const doFetch = async () =>
      fetch(url, { headers: { 'Client-Id': this.clientId, Authorization: `Bearer ${await this.getToken()}` } });
    let res = await doFetch();
    if (res.status === 401) {
      this.token = null; // jeton expiré ou révoqué : on en redemande un
      res = await doFetch();
    }
    if (!res.ok) throw new Error(`Twitch ${path} ${res.status}: ${await res.text()}`);
    return (await res.json()).data;
  }

  /** Renvoie le stream en cours (ou null si hors ligne). */
  async getLiveStream(login) {
    const [stream] = await this.get('streams', { user_login: login });
    return stream ?? null;
  }

  /** Nombre total de followers (accessible avec un jeton d'application). */
  async getFollowerCount(broadcasterId) {
    const url = `https://api.twitch.tv/helix/channels/followers?${new URLSearchParams({ broadcaster_id: broadcasterId, first: '1' })}`;
    const doFetch = async () => fetch(url, { headers: { 'Client-Id': this.clientId, Authorization: `Bearer ${await this.getToken()}` } });
    let res = await doFetch();
    if (res.status === 401) {
      this.token = null;
      res = await doFetch();
    }
    if (!res.ok) throw new Error(`Twitch followers ${res.status}: ${await res.text()}`);
    const { total } = await res.json();
    return Number.isFinite(total) ? total : null;
  }

  /** Clips créés depuis `startedAt` (ISO), les plus vus d'abord. */
  async getClips(broadcasterId, startedAt) {
    return this.get('clips', { broadcaster_id: broadcasterId, started_at: startedAt, first: '20' });
  }

  /** Dernière rediffusion (VOD) de la chaîne. */
  async getLatestVod(userId) {
    const [video] = await this.get('videos', { user_id: userId, type: 'archive', first: '1' });
    return video ?? null;
  }

  /** Planning Twitch (null s'il n'y en a pas). */
  async getSchedule(broadcasterId) {
    try {
      return await this.get('schedule', { broadcaster_id: broadcasterId, first: '20' });
    } catch (err) {
      if (/ 404/.test(err.message)) return null;
      throw err;
    }
  }

  async getUser(login) {
    const [user] = await this.get('users', { login });
    return user ?? null;
  }
}

module.exports = { TwitchClient };
