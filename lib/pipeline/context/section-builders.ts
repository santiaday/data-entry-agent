/**
 * Build individual context sections from fetch results.
 *
 * Each builder takes raw fetched data and produces a formatted markdown string
 * suitable for inclusion in the LLM extraction prompt.
 */

import type { FetchResult } from '../types/pipeline';
import type { SfRecord, OutreachMailing, GongTranscriptResponse, GongExtensiveResponse } from '../types/api-responses';
import { truncateToTokenBudget, SECTION_TOKEN_BUDGETS } from './token-budget';

// ── SF Objects ──────────────────────────────────────────────

/** Format all SF record fields as markdown. */
export function buildSfObjectsSection(
  account: FetchResult,
  contacts: FetchResult,
  opportunities: FetchResult,
  leads: FetchResult,
): string {
  const parts: string[] = [];

  if (account.ok && Array.isArray(account.data) && account.data.length > 0) {
    parts.push('## Account\n' + formatRecords(account.data as SfRecord[]));
  }

  if (leads.ok && Array.isArray(leads.data) && leads.data.length > 0) {
    parts.push('## Lead(s)\n' + formatRecords(leads.data as SfRecord[]));
  }

  if (contacts.ok && Array.isArray(contacts.data) && contacts.data.length > 0) {
    parts.push('## Contact(s)\n' + formatRecords(contacts.data as SfRecord[]));
  }

  if (opportunities.ok && Array.isArray(opportunities.data) && opportunities.data.length > 0) {
    parts.push('## Opportunity(s)\n' + formatRecords(opportunities.data as SfRecord[]));
  }

  if (parts.length === 0) {
    return '[No Salesforce record data available]';
  }

  return truncateToTokenBudget(parts.join('\n\n'), SECTION_TOKEN_BUDGETS.sfObjects);
}

// ── Recent Transcript ───────────────────────────────────────

/** Format the most recent Gong transcript (full text). */
export function buildRecentTranscriptSection(
  gongTranscripts: FetchResult<GongTranscriptResponse>,
  gongExtensive: FetchResult<GongExtensiveResponse>,
): string {
  if (!gongTranscripts.ok) {
    return `[Gong transcripts unavailable: ${gongTranscripts.error}]`;
  }

  const transcripts = gongTranscripts.data;
  if (!transcripts?.callTranscripts || transcripts.callTranscripts.length === 0) {
    return '[No Gong call transcripts found]';
  }

  // Take the most recent transcript (first in the list, sorted desc by date)
  const mostRecent = transcripts.callTranscripts[0];

  const parts: string[] = [];
  parts.push(`## Most Recent Call Transcript (Call ID: ${mostRecent.callId})`);

  // Add Gong AI insights if available
  if (gongExtensive.ok && gongExtensive.data?.calls) {
    const callData = gongExtensive.data.calls.find(
      (c) => c.metaData.id === mostRecent.callId,
    );
    if (callData) {
      parts.push(formatGongInsights(callData));
    }
  }

  // Format transcript
  for (const segment of mostRecent.transcript) {
    const speaker = segment.speakerName ?? 'Unknown';
    const topic = segment.topic ? ` [Topic: ${segment.topic}]` : '';
    const text = segment.sentences.map((s) => s.text).join(' ');
    parts.push(`**${speaker}**${topic}: ${text}`);
  }

  return truncateToTokenBudget(parts.join('\n\n'), SECTION_TOKEN_BUDGETS.recentTranscript);
}

// ── Summaries ───────────────────────────────────────────────

/** Format older transcripts as summaries (topics + key points only). */
export function buildSummariesSection(
  gongTranscripts: FetchResult<GongTranscriptResponse>,
  gongExtensive: FetchResult<GongExtensiveResponse>,
): string {
  if (!gongTranscripts.ok || !gongExtensive.ok) {
    return '[Gong call summaries unavailable]';
  }

  const transcripts = gongTranscripts.data;
  if (!transcripts?.callTranscripts || transcripts.callTranscripts.length <= 1) {
    return '[No older call transcripts to summarize]';
  }

  // Skip the most recent (already in recentTranscript), summarize the rest
  const olderCallIds = transcripts.callTranscripts.slice(1).map((t) => t.callId);
  const parts: string[] = ['## Older Call Summaries'];

  for (const callId of olderCallIds) {
    const callData = gongExtensive.data?.calls?.find((c) => c.metaData.id === callId);
    if (callData) {
      parts.push(`### ${callData.metaData.title ?? callId} (${callData.metaData.started})`);
      parts.push(formatGongInsights(callData));
    }
  }

  if (parts.length <= 1) {
    return '[No summarizable call data available]';
  }

  return truncateToTokenBudget(parts.join('\n\n'), SECTION_TOKEN_BUDGETS.summaries);
}

// ── Emails ──────────────────────────────────────────────────

/** Format the 10 most recent EmailMessages. */
export function buildEmailsSection(emailMessages: FetchResult): string {
  if (!emailMessages.ok) {
    return `[Email messages unavailable: ${emailMessages.error}]`;
  }

  const records = (emailMessages.data as SfRecord[]) ?? [];
  if (records.length === 0) {
    return '[No email messages found]';
  }

  const parts: string[] = ['## Email Messages'];
  const topEmails = records.slice(0, 10);

  for (const email of topEmails) {
    const direction = email.Incoming ? 'INBOUND' : 'OUTBOUND';
    const date = email.MessageDate ?? email.CreatedDate ?? 'Unknown date';
    const subject = email.Subject ?? '(no subject)';
    const from = email.FromAddress ?? 'Unknown';
    const to = email.ToAddress ?? 'Unknown';
    const body = typeof email.TextBody === 'string' ? email.TextBody : '';

    parts.push(
      `### ${direction}: ${subject}\n` +
      `Date: ${date} | From: ${from} | To: ${to}\n\n` +
      body,
    );
  }

  return truncateToTokenBudget(parts.join('\n\n'), SECTION_TOKEN_BUDGETS.emails);
}

// ── SMS ─────────────────────────────────────────────────────

/** Format SMS tasks (filtered by TaskSubtype/Subject/Type containing "sms"). */
export function buildSmsSection(tasks: FetchResult): string {
  if (!tasks.ok) {
    return `[SMS data unavailable: ${tasks.error}]`;
  }

  const records = (tasks.data as SfRecord[]) ?? [];
  const smsRecords = records.filter((t) => isSmsTask(t));

  if (smsRecords.length === 0) {
    return '[No SMS messages found]';
  }

  const parts: string[] = ['## SMS Messages'];
  for (const sms of smsRecords) {
    const date = sms.ActivityDate ?? sms.CreatedDate ?? 'Unknown date';
    const subject = sms.Subject ?? '(no subject)';
    const body = typeof sms.Description === 'string' ? sms.Description : '';
    parts.push(`### ${subject}\nDate: ${date}\n\n${body}`);
  }

  return truncateToTokenBudget(parts.join('\n\n'), SECTION_TOKEN_BUDGETS.sms);
}

// ── Activities ──────────────────────────────────────────────

/** Format non-SMS tasks + Events. */
export function buildActivitiesSection(tasks: FetchResult, events: FetchResult): string {
  const parts: string[] = ['## Activities'];

  // Non-SMS tasks
  if (tasks.ok) {
    const records = (tasks.data as SfRecord[]) ?? [];
    const nonSms = records.filter((t) => !isSmsTask(t));

    if (nonSms.length > 0) {
      parts.push('### Tasks');
      for (const task of nonSms.slice(0, 30)) {
        const date = task.ActivityDate ?? task.CreatedDate ?? '';
        const subject = task.Subject ?? '(no subject)';
        const status = task.Status ?? '';
        parts.push(`- [${date}] ${subject} (${status})`);
      }
    }
  }

  // Events
  if (events.ok) {
    const records = (events.data as SfRecord[]) ?? [];
    if (records.length > 0) {
      parts.push('### Events');
      for (const event of records.slice(0, 30)) {
        const date = event.StartDateTime ?? event.ActivityDate ?? event.CreatedDate ?? '';
        const subject = event.Subject ?? '(no subject)';
        const type = event.Type ?? '';
        parts.push(`- [${date}] ${subject} (${type})`);
      }
    }
  }

  if (parts.length <= 1) {
    return '[No activities found]';
  }

  return truncateToTokenBudget(parts.join('\n'), SECTION_TOKEN_BUDGETS.activities);
}

// ── Outreach Mailings ───────────────────────────────────────

/** Format Outreach mailings (excluding template mailings, cleaning URLs). */
export function buildOutreachMailingsSection(outreachMailings: FetchResult): string {
  if (!outreachMailings.ok) {
    return `[Outreach mailings unavailable: ${outreachMailings.error}]`;
  }

  const response = outreachMailings.data as { data?: readonly OutreachMailing[] } | undefined;
  const mailings = response?.data ?? [];

  if (mailings.length === 0) {
    return '[No Outreach mailings found]';
  }

  const parts: string[] = ['## Outreach Mailings'];

  for (const mailing of mailings) {
    const attrs = mailing.attributes;
    if (!attrs) continue;

    const subject = attrs.subject ?? '(no subject)';
    const date = attrs.deliveredAt ?? 'Unknown date';
    let body = attrs.bodyText ?? '';

    // Clean: strip URLs and unsubscribe footers
    body = body.replace(/https?:\/\/\S+/g, '[URL]');
    body = body.replace(/unsubscribe.*$/im, '');
    body = body.trim();

    if (!body) continue;

    const status = attrs.repliedAt
      ? 'REPLIED'
      : attrs.openedAt
        ? 'OPENED'
        : attrs.bouncedAt
          ? 'BOUNCED'
          : 'DELIVERED';

    parts.push(`### ${subject}\nDate: ${date} | Status: ${status}\n\n${body}`);
  }

  if (parts.length <= 1) {
    return '[No substantive Outreach mailings found]';
  }

  return truncateToTokenBudget(parts.join('\n\n'), SECTION_TOKEN_BUDGETS.outreachMailings);
}

// ── Helpers ─────────────────────────────────────────────────

function formatRecords(records: readonly SfRecord[]): string {
  return records.map((record) => {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(record)) {
      if (key === 'attributes') continue;
      if (value === null || value === undefined || value === '') continue;
      // Exclude AI_*__c fields — those are our own extraction outputs from prior runs.
      // Including them lets the LLM lazily copy stale values instead of re-deriving
      // from conversational evidence (transcripts, emails, activities).
      if (key.startsWith('AI_') && key.endsWith('__c')) continue;
      lines.push(`- **${key}**: ${String(value)}`);
    }
    return lines.join('\n');
  }).join('\n\n---\n\n');
}

function formatGongInsights(callData: GongExtensiveResponse['calls'][number]): string {
  const parts: string[] = [];

  if (callData.content?.topics && callData.content.topics.length > 0) {
    const topicList = callData.content.topics.map((t) => t.name).join(', ');
    parts.push(`**Topics:** ${topicList}`);
  }

  if (callData.content?.trackers && callData.content.trackers.length > 0) {
    const trackerList = callData.content.trackers.map((t) => `${t.name} (${t.count}x)`).join(', ');
    parts.push(`**Trackers:** ${trackerList}`);
  }

  if (callData.content?.pointsOfInterest?.actionItems) {
    const items = callData.content.pointsOfInterest.actionItems.map((a) => `- ${a.snippet}`).join('\n');
    parts.push(`**Action Items:**\n${items}`);
  }

  if (callData.interaction?.speakers) {
    const speakers = callData.interaction.speakers
      .map((s) => `${s.name}: ${Math.round(s.talkTime / 60)}min`)
      .join(', ');
    parts.push(`**Speakers:** ${speakers}`);
  }

  return parts.join('\n');
}

function isSmsTask(record: SfRecord): boolean {
  const subtype = String(record.TaskSubtype ?? '').toLowerCase();
  const subject = String(record.Subject ?? '').toLowerCase();
  const type = String(record.Type ?? '').toLowerCase();
  // Also detect SMS via CallType (Zoom / Kixie / some dialers tag SMS this way)
  const callType = String(record.CallType ?? '').toLowerCase();
  // Subject often contains the tool name (e.g. "Zoomsms") in the CallObject
  const callObject = String(record.CallObject ?? '').toLowerCase();

  return subtype.includes('sms')
    || subject.includes('sms')
    || type.includes('sms')
    || callType.includes('sms')
    || callObject.includes('sms');
}
