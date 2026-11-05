import { sql, type SQL } from "drizzle-orm";

/** A list of texts as a Postgres text[] value: ARRAY['a', 'b']::text[]. (Writing `${list}::text[]` makes Drizzle bind each item separately, which Postgres rejects as a "malformed array literal".) */
export const textArray = (items: readonly string[]): SQL => sql`ARRAY[${sql.join(items.map((t) => sql`${t}`), sql`, `)}]::text[]`;
