const headers = { 'Cache-Control': 'no-store' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/presence') return env.ASSETS.fetch(request);
    if (request.method !== 'POST')
      return new Response('Method not allowed', { status: 405, headers });
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return new Response('Forbidden', { status: 403, headers });
    const body = await request.text();
    if (body.length > 512) return new Response('Too large', { status: 413, headers });
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return new Response('Invalid JSON', { status: 400, headers });
    }
    if (
      !data ||
      !uuid.test(data.visitor) ||
      !uuid.test(data.session) ||
      !['join', 'leave'].includes(data.action)
    )
      return new Response('Invalid presence', { status: 400, headers });
    const id = env.TOWN_PRESENCE.idFromName('town');
    return env.TOWN_PRESENCE.get(id).fetch(
      new Request(request.url, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    );
  },
};

/** One globally shared object; SQLite retains live sessions across worker restarts. */
export class TownPresence {
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS visitors (session TEXT PRIMARY KEY, visitor TEXT NOT NULL, expires INTEGER NOT NULL)',
    );
    this.sql.exec('CREATE INDEX IF NOT EXISTS visitor_expiry ON visitors(expires)');
  }
  async fetch(request) {
    const { visitor, session, action } = await request.json();
    const now = Date.now();
    this.sql.exec('DELETE FROM visitors WHERE expires <= ?', now);
    if (action === 'leave')
      this.sql.exec('DELETE FROM visitors WHERE session = ? AND visitor = ?', session, visitor);
    else
      this.sql.exec(
        'INSERT INTO visitors(session, visitor, expires) VALUES (?, ?, ?) ON CONFLICT(session) DO UPDATE SET visitor = excluded.visitor, expires = excluded.expires',
        session,
        visitor,
        now + 65000,
      );
    const [{ count }] = this.sql
      .exec('SELECT COUNT(DISTINCT visitor) AS count FROM visitors')
      .toArray();
    return Response.json({ count }, { headers });
  }
}
