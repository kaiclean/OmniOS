'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import type {
  AssetKind,
  BrandDNA,
  CreativeAsset,
  CreativeBrief,
  Scope,
} from '@/lib/domain';
import { ASSET_KINDS, makeRecordId, parseScopeKey, scopeKey, slugify } from '@/lib/domain';
import { getWorkspace, insertRecords, readCollection } from '@/lib/data/store';
import { generateProductPlan } from '@/lib/generation/product-plan';

export interface CreativeFormState {
  readonly ok: boolean;
  readonly errors?: Readonly<Record<string, string>>;
  readonly message?: string;
}

function readField(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

function readLines(form: FormData, key: string, limit: number): string[] {
  return readField(form, key)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}

/**
 * Resolve a space key sent from the browser into a scope that actually exists.
 *
 * The client only ever posts a key. Parsing it is not enough: an unknown company
 * id parses cleanly and would happily create a scope file for a company nobody
 * owns, so the id is checked against the workspace index before anything is
 * written. Shared scopes are refused outright — nothing user-authored belongs in
 * capability memory without passing the promotion gate.
 */
async function resolveSpace(
  key: string,
): Promise<{ scope: Scope; label: string; brand: BrandDNA } | null> {
  const scope = parseScopeKey(key);
  if (!scope || scope.kind === 'shared') return null;

  const workspace = await getWorkspace();
  if (scope.kind === 'personal') {
    return {
      scope,
      label: workspace.personal.displayName,
      brand: workspace.personal.personalBrand,
    };
  }

  const company = workspace.companies.find((c) => c.id === scope.companyId && !c.archivedAt);
  if (!company) return null;
  return { scope, label: company.name, brand: company.brand };
}

/* ------------------------------------------------------------- briefs ----- */

const BriefSchema = z.object({
  title: z.string().trim().min(2, 'Give the brief a name you would recognise later.').max(90),
  objective: z
    .string()
    .trim()
    .min(8, 'Say what this brief is for — one sentence is enough.')
    .max(500),
  audience: z.string().trim().max(200).default(''),
  keyMessage: z.string().trim().max(300).default(''),
  channel: z.string().trim().max(120).default(''),
  toneOverride: z.string().trim().max(200).default(''),
  formats: z
    .array(z.enum(ASSET_KINDS))
    .min(1, 'Pick at least one format. A brief with no output is a note.'),
});

/**
 * Create a real brief in the selected space.
 *
 * A brief is the reusable unit: the same record feeds a social post, an ad and a
 * deck, which is why the fields are about intent rather than about a format.
 */
export async function createBrief(
  _previous: CreativeFormState,
  form: FormData,
): Promise<CreativeFormState> {
  const space = await resolveSpace(readField(form, 'scopeKey'));
  if (!space) return { ok: false, message: 'That space no longer exists.' };

  const parsed = BriefSchema.safeParse({
    title: readField(form, 'title'),
    objective: readField(form, 'objective'),
    audience: readField(form, 'audience'),
    keyMessage: readField(form, 'keyMessage'),
    channel: readField(form, 'channel'),
    toneOverride: readField(form, 'toneOverride'),
    formats: form.getAll('formats').filter((v): v is string => typeof v === 'string'),
  });

  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const input = parsed.data;
  const now = new Date().toISOString();

  const brief: CreativeBrief = {
    id: makeRecordId('brief', `${scopeKey(space.scope)}:${slugify(input.title)}:${now}`),
    scope: space.scope,
    createdAt: now,
    updatedAt: now,
    title: input.title,
    objective: input.objective,
    // Absent answers stay absent rather than becoming invented defaults — the
    // Studio shows a dash and the composed prompt simply omits the line.
    audience: input.audience,
    keyMessage: input.keyMessage,
    mustInclude: readLines(form, 'mustInclude', 8),
    mustAvoid: readLines(form, 'mustAvoid', 8),
    formats: input.formats,
    ...(input.channel ? { channel: input.channel } : {}),
    ...(input.toneOverride ? { toneOverride: input.toneOverride } : {}),
  };

  await insertRecords(space.scope, 'briefs', [brief]);
  revalidatePath('/', 'layout');

  return { ok: true, message: `Brief created in ${space.label}.` };
}

/* ------------------------------------------------------------- assets ----- */

/** The shape each format is produced at. One decision, applied consistently. */
const ASPECT_BY_KIND: Record<AssetKind, CreativeAsset['aspect']> = {
  image: '3:2',
  video: '16:9',
  ad: '4:5',
  presentation: '16:9',
  logo: '1:1',
  website: '16:9',
  app: '9:16',
  'ui-design': '16:9',
  'product-photo': '1:1',
  'marketing-asset': '4:5',
  'social-post': '4:5',
};

/** Which specialist would own the format. Ids are real entries in lib/ai/specialists.ts. */
const SPECIALIST_BY_KIND: Record<AssetKind, string> = {
  image: 'photographer',
  video: 'video',
  ad: 'marketer',
  presentation: 'copywriter',
  logo: 'brand',
  website: 'designer',
  app: 'designer',
  'ui-design': 'designer',
  'product-photo': 'photographer',
  'marketing-asset': 'designer',
  'social-post': 'social',
};

const KIND_LABEL = (kind: AssetKind): string => kind.replace(/-/g, ' ');

/**
 * The prompt an image model would receive.
 *
 * This is the part of the pipeline that is genuinely hard and genuinely finished:
 * the brief's intent and the space's Brand DNA are merged into one instruction,
 * stored on the record, and shown in the UI. Attaching a renderer means passing
 * this string and the aspect to a provider — nothing above it has to change.
 */
function composePrompt(brief: CreativeBrief, kind: AssetKind, brand: BrandDNA): string {
  const lines = [
    `Produce a ${KIND_LABEL(kind)} at ${ASPECT_BY_KIND[kind]} for the brief “${brief.title}”.`,
    `Objective: ${brief.objective}`,
  ];
  if (brief.audience) lines.push(`Audience: ${brief.audience}`);
  if (brief.keyMessage) lines.push(`Key message: ${brief.keyMessage}`);
  if (brief.channel) lines.push(`Channel: ${brief.channel}`);
  if (brief.mustInclude.length > 0) lines.push(`Must include: ${brief.mustInclude.join('; ')}`);
  if (brief.mustAvoid.length > 0) lines.push(`Must avoid: ${brief.mustAvoid.join('; ')}`);
  lines.push(
    `Voice: ${brand.voice.join(', ')}. Tone: ${brief.toneOverride ?? brand.tone}`,
    `Typography: ${brand.typography}`,
    `Imagery: ${brand.imagery}`,
    `Palette: ${brand.palette.map((colour) => `${colour.name} ${colour.value}`).join(', ')}`,
    `Never: ${brand.doNot.join('; ')}`,
  );
  return lines.join('\n');
}

/**
 * Turn a brief into asset records — one per format the brief asked for.
 *
 * Every record lands with status `brief`: the intent, the prompt and the review
 * state are real, and the only missing step is the render. Nothing is sent
 * anywhere and no provider key is read.
 */
export async function generateAssetsFromBrief(
  _previous: CreativeFormState,
  form: FormData,
): Promise<CreativeFormState> {
  const space = await resolveSpace(readField(form, 'scopeKey'));
  if (!space) return { ok: false, message: 'That space no longer exists.' };

  const briefId = readField(form, 'briefId');
  // Read through the scope rather than trusting the posted id: a brief from
  // another space is simply not in this list, so it cannot be reached.
  const briefs = await readCollection(space.scope, 'briefs');
  const brief = briefs.find((candidate) => candidate.id === briefId);
  if (!brief) return { ok: false, message: 'That brief is no longer in this space.' };
  if (brief.formats.length === 0) {
    return { ok: false, message: 'This brief names no formats, so there is nothing to produce.' };
  }

  const now = new Date().toISOString();
  const assets: CreativeAsset[] = brief.formats.map((kind, index) => {
    // The timestamp is in the seed so a second run produces a second batch rather
    // than colliding with the first — a founder may deliberately want variants.
    const seed = `${scopeKey(space.scope)}:${brief.id}:${kind}:${now}:${index}`;
    return {
      id: makeRecordId('asset', seed),
      scope: space.scope,
      createdAt: now,
      updatedAt: now,
      title: `${brief.title} — ${KIND_LABEL(kind)}`,
      kind,
      status: 'brief',
      briefId: brief.id,
      prompt: composePrompt(brief, kind, space.brand),
      previewSeed: seed,
      aspect: ASPECT_BY_KIND[kind],
      generatedBy: SPECIALIST_BY_KIND[kind],
      notes: 'Prompt composed and stored. No image model has run — see the Studio note.',
      simulated: true,
    };
  });

  await insertRecords(space.scope, 'assets', assets);
  revalidatePath('/', 'layout');

  return {
    ok: true,
    message: `${assets.length} asset ${assets.length === 1 ? 'record' : 'records'} written, awaiting a renderer.`,
  };
}

/* ------------------------------------------------------------ products ---- */

const ProductSchema = z.object({
  idea: z.string().trim().min(10, 'Describe the idea in a sentence or two.').max(600),
  problem: z.string().trim().min(6, 'Name the problem it removes.').max(400),
  audience: z.string().trim().min(3, 'Who is this for?').max(200),
  name: z.string().trim().max(60).default(''),
});

/**
 * Plan a product into the chosen space.
 *
 * The generator is deterministic and local; this action does the two things a
 * generator must not do — decide where the record lives, and persist it.
 */
export async function planProduct(
  _previous: CreativeFormState,
  form: FormData,
): Promise<CreativeFormState> {
  const space = await resolveSpace(readField(form, 'scopeKey'));
  if (!space) return { ok: false, message: 'Pick a space to plan this into.' };

  const parsed = ProductSchema.safeParse({
    idea: readField(form, 'idea'),
    problem: readField(form, 'problem'),
    audience: readField(form, 'audience'),
    name: readField(form, 'name'),
  });

  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const input = parsed.data;

  const spec = generateProductPlan({
    idea: input.idea,
    problem: input.problem,
    audience: input.audience,
    scope: space.scope,
    ...(input.name ? { name: input.name } : {}),
  });

  await insertRecords(space.scope, 'products', [spec]);
  revalidatePath('/', 'layout');
  redirect(`/factory?spec=${encodeURIComponent(spec.id)}`);
}
