// Signing in to Spotify (OAuth with PKCE: no server and no secret). The sign-in page
// opens in its own window and Spotify sends the person back to Cassiel's
// /oauth/callback.html, which hands the code to this app; the app exchanges it, with
// the secret it made (the verifier), for tokens it keeps through the SDK's
// localStorage (in agentd, for this app only).
(() => {
  const CLIENT_ID = 'acef005407d94b3299505282dc0150e0';
  const SCOPES = [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-library-read',
    'playlist-read-private',
    'playlist-read-collaborative',
  ].join(' ');
  const KEY = 'spotify.tokens';

  /** Where Spotify sends the person back: the desktop's callback page. Spotify takes
   * plain http only for a loopback address, so on this machine it is 127.0.0.1. */
  const redirectUri = () => {
    const { protocol, hostname, port } = location;
    const at = port ? `:${port}` : '';
    if (hostname.endsWith('.localhost')) return `http://127.0.0.1${at}/oauth/callback.html`;
    const first = hostname.slice(0, hostname.indexOf('.'));
    const dash = first.indexOf('--');
    if (dash > 0) return `${protocol}//${first.slice(dash + 2)}${hostname.slice(hostname.indexOf('.'))}${at}/oauth/callback.html`;
    return null;
  };

  const random = (bytes) => {
    const a = crypto.getRandomValues(new Uint8Array(bytes));
    return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const challengeOf = async (verifier) => {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    return btoa(String.fromCharCode(...hash)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? 'null');
    } catch {
      return null;
    }
  };
  const keep = (tokens) => localStorage.setItem(KEY, JSON.stringify(tokens));

  const exchange = async (body) => {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, ...body }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error_description || data.error || 'Spotify did not sign in.');
    const old = read();
    const tokens = {
      access: data.access_token,
      refresh: data.refresh_token ?? old?.refresh,
      expires: Date.now() + (data.expires_in - 60) * 1000,
    };
    keep(tokens);
    return tokens;
  };

  /** Opens Spotify's sign-in and resolves once signed in. */
  async function signIn() {
    const redirect = redirectUri();
    if (!redirect) throw new Error('Spotify sign-in needs Cassiel opened by its name (localhost or its address), not by an IP.');
    const verifier = random(48);
    const state = random(16);
    const url =
      'https://accounts.spotify.com/authorize?' +
      new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: redirect,
        scope: SCOPES,
        state,
        code_challenge_method: 'S256',
        code_challenge: await challengeOf(verifier),
      });
    const popup = window.open(url, 'spotify-sign-in', 'width=480,height=720');
    if (!popup) throw new Error('The sign-in window was blocked.');
    const params = await new Promise((resolve, reject) => {
      const onMessage = (e) => {
        if (e.source !== popup || !e.data?.cassielOAuth) return;
        cleanup();
        resolve(e.data.cassielOAuth);
      };
      const closed = setInterval(() => popup.closed && (cleanup(), reject(new Error('Sign-in was closed.'))), 500);
      const cleanup = () => {
        removeEventListener('message', onMessage);
        clearInterval(closed);
      };
      addEventListener('message', onMessage);
    });
    if (params.error) throw new Error(params.error === 'access_denied' ? 'Sign-in was cancelled.' : params.error);
    if (params.state !== state || !params.code) throw new Error('Spotify sent back an answer that was not for this sign-in.');
    await exchange({ grant_type: 'authorization_code', code: params.code, redirect_uri: redirect, code_verifier: verifier });
  }

  /** A live access token, refreshed when needed; null when signed out. */
  async function token() {
    const tokens = read();
    if (!tokens) return null;
    if (Date.now() < tokens.expires) return tokens.access;
    if (!tokens.refresh) return null;
    try {
      return (await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh })).access;
    } catch {
      localStorage.removeItem(KEY);
      return null;
    }
  }

  window.SpotifyAuth = {
    signIn,
    token,
    signOut: () => localStorage.removeItem(KEY),
    signedIn: () => !!read(),
  };
})();
