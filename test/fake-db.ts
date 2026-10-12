// Minimal in-memory stand-in for the supabase-js query builder calls the Worker makes.
type Row = Record<string, any>;

export function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = structuredClone(seed);
  const table = (name: string) => (tables[name] ??= []);

  function from(name: string) {
    const filters: [string, unknown][] = [];
    const match = (r: Row) => filters.every(([k, v]) => r[k] === v);
    const builder: any = {
      select: () => builder,
      eq: (k: string, v: unknown) => (filters.push([k, v]), builder),
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: table(name).find(match) ?? null, error: null }),
      single: async () => {
        const r = table(name).find(match);
        return r ? { data: r, error: null } : { data: null, error: new Error('no rows') };
      },
      then: (res: any) => res({ data: table(name).filter(match), error: null }),
      insert: async (row: Row) => (table(name).push({ ...row }), { error: null }),
      upsert: async (row: Row, opts: { onConflict: string; ignoreDuplicates?: boolean }) => {
        const key = opts.onConflict;
        const i = table(name).findIndex((r) => r[key] === row[key]);
        if (i === -1) table(name).push({ ...row });
        else if (!opts.ignoreDuplicates) table(name)[i] = { ...table(name)[i], ...row };
        return { error: null };
      },
    };
    return builder;
  }
  return { db: { from } as any, tables };
}
