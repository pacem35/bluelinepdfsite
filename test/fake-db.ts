// Minimal in-memory stand-in for the supabase-js query-builder calls the Worker makes.
type Row = Record<string, any>;
let seq = 0;

export function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = structuredClone(seed);
  const table = (name: string) => (tables[name] ??= []);

  function from(name: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let op: { kind: 'select' } | { kind: 'update'; patch: Row } | { kind: 'insert'; rows: Row[] } = { kind: 'select' };
    const match = (r: Row) => filters.every((f) => f(r));

    const run = (): { data: Row[]; error: Error | null } => {
      if (op.kind === 'insert') {
        for (const r of op.rows) {
          const uniqueClash = ['stripe_customer_id', 'license_key', 'stripe_subscription_id', 'stripe_invoice_line_id'].some(
            (k) => r[k] != null && table(name).some((x) => x[k] === r[k]),
          );
          if (uniqueClash) return { data: [], error: new Error('duplicate key') };
        }
        const rows = op.rows.map((r) => ({ id: r.id ?? `${name}-${++seq}`, ...r }));
        table(name).push(...rows);
        return { data: rows, error: null };
      }
      const hit = table(name).filter(match);
      if (op.kind === 'update') for (const r of hit) Object.assign(r, (op as any).patch);
      return { data: hit, error: null };
    };

    const b: any = {
      select: () => b,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), b),
      order: () => b,
      limit: () => b,
      insert: (row: Row | Row[]) => ((op = { kind: 'insert', rows: Array.isArray(row) ? row : [row] }), b),
      update: (patch: Row) => ((op = { kind: 'update', patch }), b),
      upsert: async (row: Row, opts: { onConflict: string; ignoreDuplicates?: boolean }) => {
        const keys = opts.onConflict.split(',');
        const i = table(name).findIndex((r) => keys.every((k) => r[k] === row[k]));
        if (i === -1) table(name).push({ ...row });
        else if (!opts.ignoreDuplicates) table(name)[i] = { ...table(name)[i], ...row };
        return { error: null };
      },
      maybeSingle: async () => {
        const { data, error } = run();
        return { data: data[0] ?? null, error };
      },
      single: async () => {
        const { data, error } = run();
        if (error) return { data: null, error };
        return data[0] ? { data: data[0], error: null } : { data: null, error: new Error('no rows') };
      },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  }
  return { db: { from } as any, tables };
}
