/**
 * Reconcile the local catalogue against the animals register, row by row (salish-ox2.1).
 *
 * WHY THIS EXISTS. ADR-0012 decides that this repository "stops holding independent
 * identity and becomes a materialization of" the register, and salish-ox2 is that
 * migration. Before any schema moves, someone has to be able to say — per row, not in
 * aggregate — which register entity each catalogue row corresponds to, or why it has
 * none. This is measurement only. It changes no schema and decides nothing.
 *
 * THE INDICATIVE PASS IT REPLACES matched 572 of 575 designation codes with an ad-hoc
 * "upcase and strip punctuation" fold. That number is not trustworthy, because the
 * register publishes its own comparison rule and that was not it. ADR-0019 defines the
 * fold in four ordered steps and ships `dist/fold_test.tsv` as executable cases; one
 * clause it deliberately omits is folding a trailing `s`, because that merges a matriline
 * with its matriarch — the exact pair this report has to keep apart. So the fold here is
 * checked against the published cases before a single row is matched, and the run aborts
 * if it disagrees.
 *
 * WHY IT READS A RELEASE, not `register.*` in the database. The report has to be re-runnable
 * against an edition that is not loaded yet, so that a proposed upgrade can be diffed
 * against the one in production before it is adopted. It also lets the report use
 * `dist/searchable_name.tsv` — the register's own published answer to "what can be typed"
 * — rather than re-deriving it from entities and names, which is the reimplementation
 * ADR-0013 ships that view to prevent. With no `--tag`, it reads whichever edition the
 * database says is loaded, so the default run describes what production actually holds.
 *
 * WHAT IT CANNOT DO, and this is a limit of the question rather than of the script: where
 * a catalogue row has more than one candidate, it reports the candidates. It does not
 * pick one. `T037` is a matriline's designation *and* its matriarch's label, by design —
 * 126 such pairs — and a report that guessed would manufacture the confidence this issue
 * exists to avoid.
 *
 * Usage:
 *   SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *     npx tsx scripts/register/reconcile.ts                 # print the summary
 *   npx tsx scripts/register/reconcile.ts --linked          # against production
 *   npx tsx scripts/register/reconcile.ts --linked --write  # update the checked-in report
 *   npx tsx scripts/register/reconcile.ts --tag 2026.09.1   # a later edition, not yet loaded
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postgres from 'postgres';

import { fold } from './fold.ts';
import {
    candidates, describeCandidates, substitutionFor, verdictFor, type Edition,
} from './match.ts';

const REPO = 'salish-sea/animals';
const RELEASE = (tag: string, asset: string) =>
    `https://github.com/${REPO}/releases/download/${tag}/${asset}`;

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const REPORT_MD = path.join(ROOT, 'docs', 'reference', 'register-reconciliation.md');
const REPORT_TSV = path.join(ROOT, 'docs', 'reference', 'register-reconciliation.tsv');

// ---------------------------------------------------------------------------
// Reading the published edition
// ---------------------------------------------------------------------------

async function download(url: string): Promise<Buffer> {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'salishsea.io register reconciler' },
        signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
    return Buffer.from(await res.arrayBuffer());
}

/**
 * Parse a published TSV into objects keyed by its header.
 *
 * By name rather than by position, and tolerant of columns being ADDED — the register
 * grows them (`searchable_name` gained `retired` and `replaced_by` after this was
 * written) and a reconciliation that broke on a superset would be a reason not to upgrade
 * an edition. Required columns going MISSING is still fatal.
 */
function parseTsv(text: string, required: readonly string[]): Record<string, string>[] {
    const lines = text.replace(/\n$/, '').split('\n');
    const header = lines[0]!.split('\t');
    const missing = required.filter((c) => !header.includes(c));
    if (missing.length) throw new Error(`published columns missing: ${missing.join(', ')}`);
    return lines.slice(1).map((line) => {
        const cells = line.split('\t');
        if (cells.length !== header.length)
            throw new Error(`ragged row (${cells.length} of ${header.length}): ${line.slice(0, 120)}`);
        return Object.fromEntries(header.map((h, i) => [h, cells[i]!]));
    });
}

async function readEdition(tag: string, say: (s: string) => void): Promise<Edition> {
    say(`fetching register ${tag} from ${REPO}…`);
    const [tarball, sums] = await Promise.all([
        download(RELEASE(tag, 'register-tsv.tar.gz')),
        download(RELEASE(tag, 'SHA256SUMS')).then((b) => b.toString('utf8')),
    ]);

    // Verify before reading, exactly as the loader does: an artefact that fails its digest
    // is not one we parse looking for something useful.
    const digest = createHash('sha256').update(tarball).digest('hex');
    const expected = sums.split('\n')
        .map((l) => l.trim().split(/\s+/))
        .find(([, name]) => name === 'register-tsv.tar.gz')?.[0];
    if (!expected) throw new Error('SHA256SUMS does not list register-tsv.tar.gz');
    if (digest !== expected)
        throw new Error(`digest mismatch for register-tsv.tar.gz: got ${digest}, published ${expected}`);
    say(`  digest ok: ${digest.slice(0, 16)}…`);

    const dir = mkdtempSync(path.join(tmpdir(), 'reconcile-'));
    try {
        const untar = spawnSync('tar', ['xzf', '-', '-C', dir], { input: tarball });
        if (untar.error) throw new Error(`tar could not run: ${untar.error.message}`);
        if (untar.status !== 0)
            throw new Error(`tar exited ${untar.status}: ${untar.stderr?.toString().trim() || '(no output)'}`);

        // The fold is checked against the register's own cases BEFORE anything is matched.
        // A fold that has drifted from ADR-0019 does not produce a slightly wrong report;
        // it produces a confident one, which is worse.
        const cases = parseTsv(
            readFileSync(path.join(dir, 'dist', 'fold_test.tsv'), 'utf8'), ['input', 'folded']);
        const wrong = cases.filter((c) => fold(c['input']!) !== c['folded']);
        if (wrong.length)
            throw new Error(
                `fold disagrees with ${tag}'s published cases (ADR-0019): `
                + wrong.map((c) => `${c['input']!} -> ${fold(c['input']!)}, expected ${c['folded']!}`)
                    .join('; '));
        say(`  fold reproduces all ${cases.length} published cases`);

        const rows = parseTsv(
            readFileSync(path.join(dir, 'dist', 'searchable_name.tsv'), 'utf8'),
            ['entity_id', 'name', 'type', 'entity_label', 'entity_kind', 'entity_rank']);

        const byFold = new Map<string, Set<string>>();
        const entities = new Map<string, { label: string; kind: string; rank: string }>();
        // A retired identifier KEEPS ITS NAMES upstream — the tombstone still answers to
        // the string it always did — so without this a catalogue row would resolve onto an
        // identifier the register has withdrawn, and this migration would then write it
        // into our schema. Read where published and ignored where not, so an older edition
        // reconciles exactly as it did.
        const retired = new Map<string, string | null>();
        for (const r of rows) {
            const id = r['entity_id']!;
            const key = fold(r['name']!);
            if (!byFold.has(key)) byFold.set(key, new Set());
            byFold.get(key)!.add(id);
            entities.set(id, {
                label: r['entity_label']!, kind: r['entity_kind']!, rank: r['entity_rank']!,
            });
            if (r['retired'] === '1') retired.set(id, r['replaced_by'] || null);
        }
        say(`  ${entities.size} entities, ${rows.length} searchable names`
            + (retired.size ? `, ${retired.size} retired` : ''));
        return { tag, digest, byFold, entities, retired };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------------------
// Reading the catalogue
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Query = (sql: string) => Promise<Row[]>;

/**
 * Production has no direct connection from a laptop, so it is reached the same way the
 * loader reaches it — through `supabase db query --linked`, which goes via the Management
 * API. Local and CI use a DSN directly.
 */
function linkedQuery(): Query {
    return async (sql) => {
        const run = spawnSync('npx', ['supabase', 'db', 'query', '--linked', sql],
            { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: ROOT });
        if (run.error) throw new Error(`supabase could not run: ${run.error.message}`);
        if (run.status !== 0)
            throw new Error(`supabase db query exited ${run.status}: ${run.stderr?.trim()}`);
        // The CLI prints progress lines before the JSON body; take the object, not the
        // first line that happens to look like one.
        const start = run.stdout.indexOf('{');
        if (start === -1) throw new Error(`no JSON in supabase output: ${run.stdout.slice(0, 200)}`);
        const parsed = JSON.parse(run.stdout.slice(start)) as { rows?: Row[] };
        return parsed.rows ?? [];
    };
}

function dsnQuery(dsn: string): { query: Query; close: () => Promise<void> } {
    const sql = postgres(dsn);
    return { query: (text) => sql.unsafe(text), close: () => sql.end() };
}

interface Catalogue {
    individuals: { id: number; primary_designation: string }[];
    socialGroups: { id: number; kind: string; designation: string }[];
    designations: { id: number; individual_id: number; code: string; scheme: string; is_primary: boolean }[];
    memberships: { id: number; group_id: number; individual_id: number; basis: string }[];
    nicknames: { id: number; individual_id: number | null; social_group_id: number | null; name: string }[];
    loadedEdition: string | null;
}

async function readCatalogue(query: Query): Promise<Catalogue> {
    const [individuals, socialGroups, designations, memberships, nicknames, edition] =
        await Promise.all([
            query(`SELECT id, primary_designation FROM public.individuals ORDER BY id`),
            query(`SELECT id, kind::text AS kind, designation FROM public.social_groups ORDER BY id`),
            query(`SELECT id, individual_id, code, scheme::text AS scheme, is_primary
                   FROM public.designations ORDER BY id`),
            query(`SELECT id, group_id, individual_id, basis::text AS basis
                   FROM public.group_memberships ORDER BY id`),
            query(`SELECT id, individual_id, social_group_id, name
                   FROM public.nicknames ORDER BY id`),
            query(`SELECT tag FROM register.edition`),
        ]);
    return {
        individuals: individuals as Catalogue['individuals'],
        socialGroups: socialGroups as Catalogue['socialGroups'],
        designations: designations as Catalogue['designations'],
        memberships: memberships as Catalogue['memberships'],
        nicknames: nicknames as Catalogue['nicknames'],
        loadedEdition: (edition[0]?.['tag'] as string | undefined) ?? null,
    };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** One line of the per-row artefact. */
interface Finding {
    table: string;
    row_id: string;
    subject: string;
    folded: string;
    verdict: string;
    entity_ids: string;
    detail: string;
}

function reconcile(edition: Edition, cat: Catalogue) {
    const findings: Finding[] = [];

    /**
     * entity id -> the catalogue THINGS that resolved to it, each with the rows that said
     * so.
     *
     * A thing, not a row, because a `designations` row is not a separate animal from the
     * `individuals` row it belongs to — counting rows would report all 510 individuals as
     * colliding with their own designation codes, which is true by construction and says
     * nothing. A collision is two things our schema treats as distinct landing on one
     * register entity.
     */
    const claimed = new Map<string, Map<string, string[]>>();

    const record = (
        table: string, rowId: number, subject: string, kind: 'individual' | 'group',
        thing: string, detail: string,
    ) => {
        const { all, live, ofKind, retiredOfKind } = candidates(edition, subject, kind);
        for (const id of ofKind) {
            if (!claimed.has(id)) claimed.set(id, new Map());
            const things = claimed.get(id)!;
            things.set(thing, [...(things.get(thing) ?? []), `${table}#${rowId} ${subject}`]);
        }
        const substitution = substitutionFor(edition, retiredOfKind);
        findings.push({
            table,
            row_id: String(rowId),
            subject,
            folded: fold(subject),
            verdict: verdictFor(ofKind, live, retiredOfKind),
            entity_ids: ofKind.join(' '),
            detail: [
                detail,
                ofKind.length === 1 ? '' : describeCandidates(edition, all),
                substitution ? `retired: ${substitution}` : '',
            ].filter(Boolean).join(' — '),
        });
    };

    for (const i of cat.individuals)
        record('individuals', i.id, i.primary_designation, 'individual',
            `individual:${i.id}`, 'primary_designation');
    for (const g of cat.socialGroups)
        record('social_groups', g.id, g.designation, 'group',
            `group:${g.id}`, `kind=${g.kind}`);
    for (const d of cat.designations)
        record('designations', d.id, d.code, 'individual',
            `individual:${d.individual_id}`, `scheme=${d.scheme}${d.is_primary ? ' primary' : ''}`);

    // Memberships are edges, and the register's membership is not loaded here, so what
    // this can honestly report is whether both endpoints resolve — which is what decides
    // whether an edge has anywhere to go — plus the basis histogram that sizes finding 1.
    const groupById = new Map(cat.socialGroups.map((g) => [g.id, g]));
    const individualById = new Map(cat.individuals.map((i) => [i.id, i]));
    for (const m of cat.memberships) {
        const g = groupById.get(m.group_id);
        const i = individualById.get(m.individual_id);
        const gOk = g ? candidates(edition, g.designation, 'group').ofKind.length === 1 : false;
        const iOk = i ? candidates(edition, i.primary_designation, 'individual').ofKind.length === 1 : false;
        findings.push({
            table: 'group_memberships',
            row_id: String(m.id),
            subject: `${g?.designation ?? `#${m.group_id}`} <- ${i?.primary_designation ?? `#${m.individual_id}`}`,
            folded: '',
            verdict: gOk && iOk ? 'both' : gOk ? 'group-only' : iOk ? 'individual-only' : 'neither',
            entity_ids: '',
            detail: `basis=${m.basis}`,
        });
    }

    // A nickname is a name row upstream, not an entity, so the question is not "which
    // entity is this" but "does the register already carry this name for the entity our
    // target resolves to". A nickname the register lacks is a name we would lose.
    for (const n of cat.nicknames) {
        const target = n.individual_id !== null
            ? individualById.get(n.individual_id)?.primary_designation
            : groupById.get(n.social_group_id!)?.designation;
        const kind = n.individual_id !== null ? 'individual' : 'group';
        const ofKind = target ? candidates(edition, target, kind).ofKind : [];
        const carriers = [...(edition.byFold.get(fold(n.name)) ?? [])];
        const verdict = ofKind.length !== 1
            ? 'target-unresolved'
            : carriers.includes(ofKind[0]!) ? 'carried' : 'not-carried';
        findings.push({
            table: 'nicknames',
            row_id: String(n.id),
            subject: n.name,
            folded: fold(n.name),
            verdict,
            entity_ids: ofKind.join(' '),
            detail: `target=${target ?? `#${n.individual_id ?? n.social_group_id}`} (${kind})`
                + (verdict === 'not-carried' && carriers.length
                    ? ` — the register gives this name to ${describeCandidates(edition, carriers)}` : ''),
        });
    }

    // The other direction of "more than one candidate", and the one the issue's four
    // categories do not name: several catalogue rows resolving to a SINGLE entity. It is
    // the same hazard — a migration that assigned identifiers row by row would give two
    // of our rows the same one and never notice — and it is how a real modelling
    // difference shows up, rather than a naming one.
    for (const [id, things] of [...claimed].sort()) {
        if (things.size < 2) continue;
        const e = edition.entities.get(id)!;
        findings.push({
            table: 'collision',
            row_id: id,
            subject: e.label,
            folded: '',
            verdict: 'many-catalogue-things',
            entity_ids: id,
            detail: `${e.kind}${e.rank ? `/${e.rank}` : ''} — claimed by `
                + [...things.values()].map((rows) => rows[0]!).join('; '),
        });
    }

    // The reverse direction. Only individuals and groups: a register `taxon` entity is a
    // species stand-in and has no catalogue counterpart by design (ADR-0003).
    for (const [id, e] of [...edition.entities].sort()) {
        // A retired entity is SUPPOSED to be unclaimed, so reporting it as a gap would
        // train the reader to ignore the list that catches real ones. Same reasoning the
        // register's own validator uses for its unreachable check.
        if (e.kind === 'taxon' || claimed.has(id) || edition.retired.has(id)) continue;
        findings.push({
            table: 'register',
            row_id: id,
            subject: e.label,
            folded: fold(e.label),
            verdict: 'no-catalogue-row',
            entity_ids: id,
            detail: `${e.kind}${e.rank ? `/${e.rank}` : ''}`,
        });
    }

    return findings;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function tally<T>(rows: T[], key: (r: T) => string): Map<string, number> {
    const out = new Map<string, number>();
    for (const r of rows) out.set(key(r), (out.get(key(r)) ?? 0) + 1);
    return new Map([...out].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function table(header: string[], rows: string[][]): string {
    return [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`,
        ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

function markdown(edition: Edition, cat: Catalogue, findings: Finding[]): string {
    const of = (t: string) => findings.filter((f) => f.table === t);
    const counts = (t: string) => tally(of(t), (f) => f.verdict);

    const section = (title: string, t: string, total: number, good: string, note?: string) => {
        const c = counts(t);
        const rows = [...c].map(([v, n]) =>
            [`\`${v}\``, String(n), `${((n / total) * 100).toFixed(1)}%`]);
        const problems = of(t).filter((f) => f.verdict !== good);
        return [
            `### ${title} — ${total} rows`,
            '',
            table(['verdict', 'rows', 'share'], rows),
            '',
            ...(note ? [note, ''] : []),
            problems.length
                // The blank line after the lead-in is load-bearing, not spacing: a GFM
                // table may not interrupt a paragraph, so without it every one of these
                // renders as literal pipes. `filter(Boolean)` used to eat it.
                ? [`Every row that is not \`${good}\`:`, '',
                    table(['id', 'subject', 'verdict', 'detail'],
                        problems.slice(0, 40).map((f) =>
                            [f.row_id, `\`${f.subject}\``, `\`${f.verdict}\``, f.detail || '—'])),
                    ...(problems.length > 40
                        ? ['', `…and ${problems.length - 40} more, in the TSV beside this file.`]
                        : []),
                ].join('\n')
                : `Every row is \`${good}\`.`,
            '',
        ].filter((l) => l !== null).join('\n');
    };

    // social_groups is the table where the answer differs sharply by kind, and a single
    // verdict histogram hides that: a matriline failing to match is a granularity
    // question, a named_group failing to match is ADR-0012's finding 4.
    const groupKind = new Map(cat.socialGroups.map((g) => [String(g.id), g.kind]));
    const byKind = new Map<string, Map<string, number>>();
    for (const f of of('social_groups')) {
        const k = groupKind.get(f.row_id) ?? '?';
        if (!byKind.has(k)) byKind.set(k, new Map());
        const m = byKind.get(k)!;
        m.set(f.verdict, (m.get(f.verdict) ?? 0) + 1);
    }
    const verdicts = [...new Set(of('social_groups').map((f) => f.verdict))].sort();
    const groupKindNote = [
        'Broken down by kind, because the tables above and below mean different things per kind:',
        '',
        table(['kind', ...verdicts.map((v) => `\`${v}\``), 'total'],
            [...byKind].sort().map(([k, m]) => [
                `\`${k}\``,
                ...verdicts.map((v) => String(m.get(v) ?? 0)),
                String([...m.values()].reduce((a, b) => a + b, 0)),
            ])),
        '',
        `The register holds ${[...edition.entities.values()].filter((e) => e.rank === 'matriline').length}`
        + ` matriline entities against our ${cat.socialGroups.filter((g) => g.kind === 'matriline').length}.`
        + ' A `wrong-kind-only` matriline is one whose designation names an *individual* in'
        + ' the register and no group — which is a question about how finely each side'
        + ' subdivides a matriline, not about spelling.',
        '',
        'A `named_group` resolving to `one` is not the clean result it looks like: every one'
        + ' of them lands on the matriline it names, which the collisions section below'
        + ' sets out.',
    ].join('\n');

    const unmatchedRegister = of('register');
    const basis = tally(cat.memberships, (m) => m.basis);
    const kinds = tally(cat.socialGroups, (g) => g.kind);

    return `# Register reconciliation

**Generated by [\`scripts/register/reconcile.ts\`](../../scripts/register/reconcile.ts). Not hand-edited.**
Re-run it and diff; the per-row detail is in [\`register-reconciliation.tsv\`](register-reconciliation.tsv).

- Register edition **${edition.tag}**, \`sha256:${edition.digest.slice(0, 16)}…\`, ${edition.entities.size} entities
- Loaded in this database: **${cat.loadedEdition ?? 'nothing'}**
- Names compared with the register's own fold (animals [ADR-0019](https://github.com/salish-sea/animals/blob/main/decisions/0019-names-are-compared-by-folding.md)), verified against the edition's published test cases before matching

This is measurement for the catalogue-adoption epic (\`salish-ox2\`), whose requirements come from animals [ADR-0012](https://github.com/salish-sea/animals/blob/main/decisions/0012-relationship-to-the-salishsea-io-catalogue.md). It changes no schema and decides nothing. Where a row has more than one candidate it is reported as \`many\` and left alone: \`T037\` is a matriline's designation *and* its matriarch's label, and picking one here would manufacture confidence the migration has not earned.

## Verdicts

Matching a row to an entity — \`one\` exactly one register entity of the expected kind · \`none\` no candidate under any spelling · \`many\` more than one, not to be guessed · \`wrong-kind-only\` a candidate exists but is the other kind, which is a modelling mismatch rather than a missing row · \`retired-only\` the only candidate is an identifier the register has withdrawn, so follow its replacement rather than adopting it

Retired identifiers are never matched. A tombstone keeps its names upstream, so a row would otherwise resolve onto an identifier the register has withdrawn and this migration would write it into our schema; the \`detail\` column names the replacement instead.

Nicknames, which are names upstream rather than entities — \`carried\` the register already gives this name to the same animal · \`not-carried\` it does not, so this is a name the migration would lose · \`target-unresolved\` the animal itself did not resolve, so the name could not be checked

## Per table

${section('individuals', 'individuals', cat.individuals.length, 'one')}
${section('social_groups', 'social_groups', cat.socialGroups.length, 'one', groupKindNote)}
${section('designations', 'designations', cat.designations.length, 'one')}
${section('nicknames', 'nicknames', cat.nicknames.length, 'carried')}
### group_memberships — ${cat.memberships.length} rows

Edges, not entities. What is checkable here is whether both endpoints resolve, since an
edge whose endpoints do not is an edge with nowhere to go.

${table(['endpoints resolved', 'rows'], [...counts('group_memberships')].map(([v, n]) => [`\`${v}\``, String(n)]))}

**By basis** — this is the number that sizes ADR-0012's finding 1. \`association\` membership
is [animals Q15](https://github.com/salish-sea/animals/issues/11), still open: ADR-0005
declares membership genealogical without saying what a curator does with an associational
roster.

${table(['basis', 'rows', 'share'], [...basis].map(([b, n]) =>
        [`\`${b}\``, String(n), `${((n / cat.memberships.length) * 100).toFixed(1)}%`]))}

## social_groups by kind

ADR-0012's finding 4 is that \`named_group\` — a real travelling group with a name and no
rank — has nowhere to go upstream, because the register's validator requires every group
to have one. **This edition does express them**, and not as groups: the collective name is
a \`common\` name on the ranked matriline, which is why all six resolve above and all six
appear in the collisions section. Whether that is the answer to finding 4 or an artefact of
how the source sheet was read is for \`salish-ox2.3\` to carry upstream, not for this report
to settle.

${table(['kind', 'rows'], [...kinds].map(([k, n]) => [`\`${k}\``, String(n)]))}

## Register entities claimed by more than one catalogue thing — ${of('collision').length}

Not one of the four categories this report was asked for, and the one that turned out to
matter most: a migration assigning identifiers row by row would hand two of our rows the
same \`SSA:\` and never notice. Each of these is a place where the two sides carve the same
animals into a different number of things.

${of('collision').length
        ? table(['entity', 'label', 'level', 'claimed by'], of('collision').map((f) => {
            const [level, by] = f.detail.split(' — claimed by ');
            return [`\`${f.row_id}\``, f.subject, `\`${level}\``, by!.replace(/; /g, '<br>')];
        }))
        : 'None — every register entity is claimed by at most one catalogue row.'}

## Register entities with no catalogue row — ${unmatchedRegister.length}

Individuals and groups only; a \`taxon\` entity is a species stand-in with no catalogue
counterpart by design. Grouped by level, because these are not one phenomenon: the
register carries Southern Resident material our Bigg's-only catalogue was never going to
have, and separately carries matrilines under names we do not use.

${unmatchedRegister.length
        ? table(['level', 'entities', 'examples'],
            [...tally(unmatchedRegister, (f) => f.detail)].map(([level, n]) => [
                `\`${level}\``,
                String(n),
                unmatchedRegister.filter((f) => f.detail === level).slice(0, 6)
                    .map((f) => `${f.subject} (\`${f.row_id}\`)`).join(', ')
                + (n > 6 ? ', …' : ''),
            ]))
        + '\n\nThe full list is in the TSV, filtered on `table = register`.'
        : 'None — every register individual and group is claimed by a catalogue row.'}
`;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const argv = process.argv;
    const linked = argv.includes('--linked');
    const write = argv.includes('--write');
    const tagArg = argv.includes('--tag') ? argv[argv.indexOf('--tag') + 1] : undefined;
    const say = console.error.bind(console);

    let close: (() => Promise<void>) | undefined;
    let query: Query;
    if (linked) {
        query = linkedQuery();
    } else {
        const dsn = process.env['SUPABASE_DB_URL'];
        if (!dsn) {
            console.error('SUPABASE_DB_URL is not set (or pass --linked for production)');
            process.exit(2);
        }
        ({ query, close } = dsnQuery(dsn));
    }

    try {
        say(`reading the catalogue${linked ? ' (linked project)' : ''}…`);
        const cat = await readCatalogue(query);
        say(`  ${cat.individuals.length} individuals, ${cat.socialGroups.length} groups, `
            + `${cat.designations.length} designations, ${cat.memberships.length} memberships, `
            + `${cat.nicknames.length} nicknames`);

        // `--tag` with nothing after it must not silently become "whatever is loaded":
        // the one time someone passes it is when they mean a DIFFERENT edition, and
        // reporting on production's instead would answer the wrong question convincingly.
        if (argv.includes('--tag') && (!tagArg || tagArg.startsWith('--'))) {
            console.error('--tag needs an edition, e.g. --tag 2026.08.1');
            process.exit(2);
        }
        const tag = tagArg ?? cat.loadedEdition;
        if (!tag) {
            console.error('no --tag given and register.edition is empty: nothing to reconcile against');
            process.exit(1);
        }

        const edition = await readEdition(tag, say);
        const findings = reconcile(edition, cat);

        const tsv = ['table\trow_id\tsubject\tfolded\tverdict\tentity_ids\tdetail',
            ...findings.map((f) =>
                [f.table, f.row_id, f.subject, f.folded, f.verdict, f.entity_ids, f.detail]
                    // A tab in a subject or detail would shift every field after it.
                    .map((v) => v.replace(/\t/g, ' ')).join('\t'))].join('\n') + '\n';
        const md = markdown(edition, cat, findings);

        if (write) {
            writeFileSync(REPORT_TSV, tsv);
            writeFileSync(REPORT_MD, md);
            say(`\nwrote ${path.relative(ROOT, REPORT_MD)} and ${path.relative(ROOT, REPORT_TSV)}`);
        } else {
            process.stdout.write(md);
            say('\nDry run; pass --write to update the checked-in report.');
        }
    } finally {
        await close?.();
    }
}

await main();
