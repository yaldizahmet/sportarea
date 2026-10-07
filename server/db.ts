import { Pool, PoolClient, types } from 'pg';

// Postgres büyük sayıları (COUNT, SUM, bigint) ve AVG sonuçlarını metin döndürür.
// Eski SQLite davranışıyla aynı kalsın diye sayıya çeviriyoruz.
types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // int8 / bigint
types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric

if (!process.env.DATABASE_URL) {
  console.error('FATAL ERROR: DATABASE_URL is not defined in environment variables.');
  process.exit(1);
}

const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 5,
});

// Tablolar sportarea şemasında aranır: sportarea_app rolünün varsayılan search_path'i
// veritabanında "sportarea" olarak ayarlı (bkz. schema.sql). Bu yüzden DATABASE_URL
// mutlaka sportarea_app kullanıcısıyla ve Supabase'in "Session pooler" adresiyle kurulmalı.

pool.on('error', (err) => {
  console.error('Postgres pool error:', err);
});

type Queryable = Pool | PoolClient;

// "?" yer tutucularını Postgres'in $1, $2 ... biçimine çevirir.
// Sorgularda metin içinde "?" kullanmıyoruz, bu yüzden basit dönüşüm yeterli.
const toPg = (sql: string) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

const makeDb = (q: Queryable) => ({
  async get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    const r = await q.query(toPg(sql), params);
    return r.rows[0];
  },
  async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const r = await q.query(toPg(sql), params);
    return r.rows;
  },
  async run(sql: string, params: any[] = []): Promise<{ changes: number }> {
    const r = await q.query(toPg(sql), params);
    return { changes: r.rowCount ?? 0 };
  },
});

export const db = makeDb(pool);
export type Db = ReturnType<typeof makeDb>;

// Birden fazla yazma işlemini tek seferde, ya hep ya hiç yapar.
export async function tx<T>(fn: (t: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(makeDb(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function initDB() {
  const { rows } = await pool.query('SELECT current_schema() AS s, current_user AS u');
  if (rows[0]?.s !== 'sportarea') {
    throw new Error(
      `Bağlantı "${rows[0]?.u}" kullanıcısıyla "${rows[0]?.s}" şemasına düştü. ` +
      'DATABASE_URL, sportarea_app kullanıcısıyla ve Supabase "Session pooler" adresiyle kurulmalı.'
    );
  }
  await pool.query('SELECT 1 FROM "User" LIMIT 1');
  console.log('Postgres (Supabase) bağlantısı hazır.');
}
