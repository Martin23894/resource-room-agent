// Pre-delivery regeneration plumbing.
//
// When runPreDeliveryGate() reports REGENERATE failures, this module
// orchestrates the corrective-call loop: group failures by phase,
// reissue the relevant Claude phase with surgical-edit prompts, and
// re-run the gate after each attempt. The cap (default 2 regens per
// phase, tunable via INVARIANT_GATE_MAX_REGEN_ATTEMPTS) keeps cost
// bounded; once exhausted the orchestrator returns the final gate
// result and the caller decides whether to ship (report mode) or
// hard-error (enforce mode).
//
// Architecture choices (locked in with user 2026-04-27):
//   1. Per-phase prompts, NOT per-invariant — a single corrective call
//      addresses every failure in that phase at once. Failures often
//      interact (fix one → break another); seeing them all gives Claude
//      the full picture.
//   2. Surgical edits for paper + memo — touch only the broken parts,
//      leave everything else character-for-character identical. The
//      gate runs after every other phase-specific repair, so the
//      artefact is mostly correct already.
//   3. Phase order: plan → paper → memo. Regenerating the plan
//      invalidates paper checks; regenerating the paper invalidates
//      memo checks. Cap resets between phases.
//   4. Quota gating happens at the call site (api/generate.js): only
//      when this loop returns passed=true does cacheSet + the future
//      quota decrement run. Failed regen attempts cost API spend but
//      never the teacher's monthly allowance.
//
// This module is framework-agnostic: it does not import callAnthropic
// directly. Callers pass `regenerators` — async functions that take
// (failures, ctx) and return updates to merge into ctx ({paper?, memo?,
// plan?}). This keeps prompt construction with the call-site state
// (callClaude, model, signal, logger) where it already lives.

import {
  runPreDeliveryGate,
  buildInvariantContext,
  CATEGORIES,
} from './invariants.js';

export const DEFAULT_REGEN_CAP = 2;
export const REGEN_PHASES = ['plan', 'paper', 'memo'];

// ============================================================
// PROMPT BUILDERS — pure functions of (failures, ctx)
// ============================================================

/**
 * Build the corrective system+user prompts for a paper regeneration call.
 *
 * @param {Array<{id, feedback}>} failures — REGENERATE failures with
 *                                            regeneratePhase==='paper'
 * @param {object} ctx — buildInvariantContext result; we read paper,
 *                       grade, subject, resourceType, language, etc.
 * @returns {{ system: string, user: string }}
 */
export function buildPaperRegenPrompts(failures, ctx) {
  const grade        = ctx.grade ?? '';
  const subject      = ctx.subject || '';
  const resourceType = ctx.resourceType || '';
  const language     = ctx.language || 'English';

  const system = `You are correcting specific verified flaws in a South African CAPS Grade ${grade} ${subject} ${resourceType} question paper in ${language}.

OUTPUT RULES — non-negotiable:
- Output the COMPLETE corrected paper. No JSON, no markdown fences, no preamble.
- Start IMMEDIATELY with the first line of the paper.
- Edit ONLY the parts the failures call out. Leave every other line, mark, and section header character-for-character identical.
- Preserve every (X) mark value unless a failure explicitly requires changing it.
- Preserve every section [N] block total and the final TOTAL line.
- No commentary, no "Corrected version:", no reasoning text anywhere in your output.`;

  const failureList = failures
    .map((f, i) => `${i + 1}. [${f.id}] ${f.feedback || f.message}`)
    .join('\n');

  const user = `The paper failed ${failures.length} pre-delivery invariant(s). Fix each one. Output the complete corrected paper.

FAILURES:
${failureList}

CURRENT PAPER:
${ctx.paper}`;

  return { system, user };
}

/**
 * Build the corrective system+user prompts for a memo regeneration call.
 *
 * The paper goes into the SYSTEM message (cacheable across attempts in
 * a single gate run); the failing memo goes into the USER message.
 */
export function buildMemoRegenPrompts(failures, ctx) {
  const grade        = ctx.grade ?? '';
  const subject      = ctx.subject || '';
  const resourceType = ctx.resourceType || '';
  const language     = ctx.language || 'English';

  const tableEnglish  = '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |';
  const tableAfrikaans = '| NR. | ANTWOORD | MERKINGSRIGLYNE | KOGNITIEWE VLAK | PUNTE |';
  const tableHeader = language === 'Afrikaans' ? tableAfrikaans : tableEnglish;

  const system = `You are correcting specific verified flaws in the memorandum for a South African CAPS Grade ${grade} ${subject} ${resourceType} in ${language}.

The memorandum has two mandatory sections:
1. Answer table with header row: ${tableHeader}
2. COGNITIVE LEVEL ANALYSIS section with the per-level breakdown table.

OUTPUT RULES — non-negotiable:
- Output the COMPLETE corrected memorandum. Both sections must be present.
- One MEMORANDUM banner at the top. No duplicates.
- Every memo answer row must correspond to a paper sub-question — no phantom rows, no missing rows.
- Every memo answer mark must equal its paper sub-question's (X) value.
- Cognitive level labels must be in ${language} (Afrikaans memos use Afrikaans level names).
- No JSON, no fences, no commentary.

PAPER (for reference — do NOT modify):
${ctx.paper}`;

  const failureList = failures
    .map((f, i) => `${i + 1}. [${f.id}] ${f.feedback || f.message}`)
    .join('\n');

  const user = `The memorandum failed ${failures.length} pre-delivery invariant(s). Fix each one. Output the complete corrected memorandum.

FAILURES:
${failureList}

CURRENT MEMORANDUM:
${ctx.memo}`;

  return { system, user };
}

/**
 * Build a corrective addendum for the plan-regen call. The caller
 * appends this to its existing planSys (lib/prompts.js) and reissues
 * the same plan tool-use call.
 */
export function buildPlanRegenAddendum(failures /* , ctx */) {
  const failureList = failures
    .map((f, i) => `${i + 1}. ${f.feedback || f.message}`)
    .join('\n');
  return `\n\nCORRECTION CONTEXT — the previous plan failed validation:\n${failureList}\n\nGenerate a fresh plan that does not repeat these issues.`;
}

// ============================================================
// ORCHESTRATOR
// ============================================================

/**
 * Run the pre-delivery gate and, if blocking failures exist, attempt
 * regeneration up to `cap` times per phase. Returns the final gate
 * result plus the updated ctx.
 *
 * Phase order is fixed: plan → paper → memo. Cap resets between phases
 * (so a paper that needs 2 paper regens AND 1 memo regen is fine).
 *
 * @param {object} args
 * @param {object} args.ctx          — initial buildInvariantContext result
 * @param {object} args.regenerators — { plan?, paper?, memo? } — async
 *      (failures, ctx, {signal}) → Promise<{ paper?, memo?, plan? }>.
 *      Returned object MERGES into ctx; phases the caller doesn't
 *      regenerate (e.g. plan) can be omitted entirely.
 * @param {number} [args.cap]        — per-phase regen cap (default 2,
 *                                     env INVARIANT_GATE_MAX_REGEN_ATTEMPTS)
 * @param {object} [args.logger]     — pino-style logger
 * @param {object} [args.channel]    — SSE event channel (sendPhase API)
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<{
 *   gate: { passed, mode, failures, blocking },
 *   ctx:  object,
 *   attemptsByPhase: { plan: number, paper: number, memo: number },
 *   capExhausted: string[],
 * }>}
 */
export async function runRegenerationLoop({
  ctx,
  regenerators = {},
  cap,
  logger = null,
  channel = null,
  signal = null,
} = {}) {
  const effectiveCap = Number.isFinite(cap)
    ? cap
    : (parseInt(process.env.INVARIANT_GATE_MAX_REGEN_ATTEMPTS, 10) || DEFAULT_REGEN_CAP);

  let currentCtx = ctx;
  const attemptsByPhase = { plan: 0, paper: 0, memo: 0 };
  const capExhausted = [];

  // Initial gate. If clean, we're done — no regen calls needed.
  let gate = runPreDeliveryGate(currentCtx, { mode: 'report', logger });
  if (gate.passed) {
    return { gate, ctx: currentCtx, attemptsByPhase, capExhausted };
  }

  for (const phase of REGEN_PHASES) {
    if (!regenerators[phase]) continue;

    for (let attempt = 1; attempt <= effectiveCap; attempt++) {
      // Re-evaluate before every attempt: a previous phase's regen may
      // have already cleared this phase's failures, or a memo regen may
      // have introduced a new paper failure. Using fresh failures means
      // each attempt addresses the current state, not a stale snapshot.
      gate = runPreDeliveryGate(currentCtx, { mode: 'report', logger });
      const phaseFailures = gate.blocking.filter(
        (f) => f.regeneratePhase === phase,
      );
      if (phaseFailures.length === 0) break;

      attemptsByPhase[phase] = attempt;
      if (channel) {
        channel.sendPhase(`regenerate.${phase}`, 'attempt', {
          n: attempt,
          cap: effectiveCap,
          ids: phaseFailures.map((f) => f.id),
        });
      }
      if (logger) {
        logger.info(
          { phase, attempt, cap: effectiveCap, ids: phaseFailures.map((f) => f.id) },
          'Pre-delivery gate: regeneration attempt',
        );
      }

      let updates;
      try {
        updates = await regenerators[phase](phaseFailures, currentCtx, { signal });
      } catch (err) {
        // A regen call that throws (timeout, abort, anthropic error)
        // ends THIS phase's loop — no point retrying with the same
        // input. The gate result we return reflects the un-fixed state.
        if (logger) {
          logger.warn(
            { phase, attempt, err: err?.message },
            'Pre-delivery gate: regeneration call threw — aborting phase',
          );
        }
        if (channel) {
          channel.sendPhase(`regenerate.${phase}`, 'failed', {
            n: attempt,
            error: err?.message || String(err),
          });
        }
        // Re-throw aborts so the outer pipeline can short-circuit
        // (matches AnthropicError ABORTED handling elsewhere).
        if (err?.code === 'ABORTED' || signal?.aborted) throw err;
        break;
      }

      // Merge updates into ctx. Whitelist allowed fields so a runaway
      // regenerator can't, e.g., overwrite cogMarks or totalMarks.
      const merged = { ...currentCtx };
      if (typeof updates?.paper === 'string') merged.paper = updates.paper;
      if (typeof updates?.memo === 'string')  merged.memo  = updates.memo;
      if (updates?.plan && typeof updates.plan === 'object') merged.plan = updates.plan;
      currentCtx = merged;

      if (channel) {
        channel.sendPhase(`regenerate.${phase}`, 'attempt_done', {
          n: attempt,
        });
      }
    }

    // Did this phase clear its failures within the cap?
    gate = runPreDeliveryGate(currentCtx, { mode: 'report', logger });
    const stillFailing = gate.blocking.some((f) => f.regeneratePhase === phase);
    if (stillFailing) {
      capExhausted.push(phase);
      if (channel) {
        channel.sendPhase(`regenerate.${phase}`, 'cap_exhausted', {
          attempts: attemptsByPhase[phase],
        });
      }
      if (logger) {
        logger.warn(
          { phase, attempts: attemptsByPhase[phase] },
          'Pre-delivery gate: regen cap exhausted, failures persist',
        );
      }
    } else if (attemptsByPhase[phase] > 0) {
      if (channel) {
        channel.sendPhase(`regenerate.${phase}`, 'done', {
          attempts: attemptsByPhase[phase],
        });
      }
      if (logger) {
        logger.info(
          { phase, attempts: attemptsByPhase[phase] },
          'Pre-delivery gate: phase regeneration succeeded',
        );
      }
    }
  }

  // Final gate, identical mode-handling as caller would do post-loop
  // (we always return mode='report' here — the caller decides whether
  // to escalate to enforce by inspecting `gate.passed`).
  gate = runPreDeliveryGate(currentCtx, { mode: 'report', logger });
  return { gate, ctx: currentCtx, attemptsByPhase, capExhausted };
}

// ============================================================
// CONVENIENCE: build a regenerator pair backed by a callClaude callback
// ============================================================

/**
 * Wrap a callClaude(system, user, maxTokens) callback into a regenerator
 * for the paper or memo phase, with the prompt builder baked in. The
 * caller still controls cleanOutput, max-token sizing, and any post-
 * regeneration repair pass (e.g. ensureSequentialSectionLetters) by
 * supplying `cleanFn`.
 *
 * @param {object} args
 * @param {(sys:string, usr:string, tok:number) => Promise<string>} args.callClaude
 * @param {(text:string) => string} [args.cleanFn]
 * @param {number} [args.maxTokens]
 * @param {'paper'|'memo'} args.phase
 * @returns {(failures, ctx) => Promise<{paper?:string, memo?:string}>}
 */
export function makeClaudeRegenerator({ callClaude, cleanFn, maxTokens = 4096, phase }) {
  if (phase !== 'paper' && phase !== 'memo') {
    throw new Error(`makeClaudeRegenerator: unsupported phase "${phase}"`);
  }
  const builder = phase === 'paper' ? buildPaperRegenPrompts : buildMemoRegenPrompts;
  return async function regenerate(failures, ctx /* , { signal } */) {
    const { system, user } = builder(failures, ctx);
    const raw = await callClaude(system, user, maxTokens);
    const cleaned = typeof cleanFn === 'function' ? cleanFn(raw) : raw;
    return phase === 'paper' ? { paper: cleaned } : { memo: cleaned };
  };
}
