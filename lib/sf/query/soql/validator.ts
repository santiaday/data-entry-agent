import type { SystemRuleRow } from './system-rules';

/**
 * SOQL safety validator.
 *
 * All production Salesforce queries go through this — it is the last
 * line of defense between the deterministic resolver and the live API.
 *
 * Rules:
 *   1. Must be a SELECT statement.
 *   2. No DML/DDL keywords anywhere (word-boundary match to avoid
 *      false positives on identifiers like `Updated_At__c`).
 *   3. PII fields defined in system_rules must not appear in SELECT.
 *   4. Queries against Account/Opportunity/Lead/Contact must filter
 *      test accounts — auto-injected if missing.
 */

const DML_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'UPSERT',
  'MERGE',
  'UNDELETE',
];

const DDL_KEYWORDS = ['CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'GRANT', 'REVOKE'];

/** Default objects for Test_Account__c filter; overridden by system_rules at runtime. */
const DEFAULT_TEST_ACCOUNT_OBJECTS = new Set([
  'Account',
  'Opportunity',
  'Lead',
  'Contact',
]);

export type ValidationResult = {
  ok: boolean;
  /** Possibly-rewritten SOQL, safe to send to Salesforce. */
  sanitizedQuery: string;
  warnings: string[];
  errors: string[];
  /** Fields that were stripped from the SELECT clause (PII). */
  strippedFields: string[];
  /** True if Test_Account__c filter was auto-injected. */
  testAccountFilterInjected: boolean;
};

export function validateSoql(
  query: string,
  systemRules: SystemRuleRow[],
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const strippedFields: string[] = [];
  let testAccountFilterInjected = false;

  const trimmed = query.trim();

  // 1. SELECT-only check
  if (!/^SELECT\b/i.test(trimmed)) {
    errors.push('Query must begin with SELECT');
    return {
      ok: false,
      sanitizedQuery: query,
      warnings,
      errors,
      strippedFields,
      testAccountFilterInjected,
    };
  }

  // 2. DML/DDL keyword check (word-boundary, case-insensitive)
  const blocked = [...DML_KEYWORDS, ...DDL_KEYWORDS];
  for (const keyword of blocked) {
    const pattern = new RegExp(`\\b${keyword}\\b`, 'i');
    if (pattern.test(trimmed)) {
      errors.push(`Query contains blocked keyword: ${keyword}`);
    }
  }

  // CASE WHEN isn't valid Salesforce SOQL — reject before we send it.
  // Previously this check lived in the Claude tool handler; moving it here
  // protects every caller (tool handler, batch runner, CLI, etc).
  if (/\bCASE\s+WHEN\b/i.test(trimmed)) {
    errors.push(
      'CASE WHEN is not valid Salesforce SOQL. For non-groupable fields, use execute_segmented_query. For conversion rates, use execute_cohort_conversion.',
    );
  }

  if (errors.length > 0) {
    return {
      ok: false,
      sanitizedQuery: query,
      warnings,
      errors,
      strippedFields,
      testAccountFilterInjected,
    };
  }

  // 3. PII blocklist (strip from SELECT clause, record warning)
  const piiRule = systemRules.find(
    (r) =>
      r.system === 'salesforce' &&
      (r.rule_name === 'salesforce_blocklist' ||
        r.rule_name === 'pii_blocklist'),
  );

  let working = trimmed;
  if (piiRule && piiRule.rule_config && typeof piiRule.rule_config === 'object') {
    const cfg = piiRule.rule_config as {
      fields?: string[];
      patterns?: string[];
    };
    const blockedFields = new Set((cfg.fields ?? []).map((f) => f.toLowerCase()));
    const blockedPatterns = cfg.patterns ?? [];

    const result = stripPiiFromSelect(working, blockedFields, blockedPatterns);
    working = result.query;
    strippedFields.push(...result.stripped);
    if (result.stripped.length > 0) {
      warnings.push(
        `Stripped ${result.stripped.length} PII field(s) from SELECT: ${result.stripped.join(', ')}`,
      );
    }
  }

  // 4. Test account auto-injection — derive guarded objects from system_rules if available
  const testAccountRule = systemRules.find(
    (r) => r.rule_name.includes('Test_Account') || r.rule_name.includes('exclude_Test'),
  );
  const guardedObjects = testAccountRule?.applies_to_objects?.length
    ? new Set(testAccountRule.applies_to_objects)
    : DEFAULT_TEST_ACCOUNT_OBJECTS;
  const fromObject = extractPrimaryFromObject(working);
  if (fromObject && guardedObjects.has(fromObject)) {
    if (!hasTestAccountFilter(working)) {
      working = injectTestAccountFilter(working);
      testAccountFilterInjected = true;
      warnings.push(
        `Auto-injected Test_Account__c = false filter for ${fromObject}`,
      );
    }
  }

  return {
    ok: true,
    sanitizedQuery: working,
    warnings,
    errors,
    strippedFields,
    testAccountFilterInjected,
  };
}

/**
 * Parse the SELECT clause and remove any field matching a blocked name
 * or substring pattern. Aggregations (COUNT, SUM) and subqueries are
 * left untouched — this only scrubs bare field names.
 */
function stripPiiFromSelect(
  query: string,
  blockedFields: Set<string>,
  blockedPatterns: string[],
): { query: string; stripped: string[] } {
  // Extract everything between SELECT and FROM (non-greedy, case-insensitive).
  // Only the top-level SELECT — not subqueries inside WHERE clauses.
  const match = query.match(/^(SELECT\s+)([\s\S]*?)(\s+FROM\s+)/i);
  if (!match) return { query, stripped: [] };

  const [, selectKw, fieldsClause, fromKw] = match;
  const fields = splitSelectFields(fieldsClause);
  const kept: string[] = [];
  const stripped: string[] = [];

  for (const rawField of fields) {
    const field = rawField.trim();
    if (!field) continue;

    // Extract the underlying field name (handles aliases and dot paths)
    const core = extractCoreFieldName(field);
    const coreLower = core.toLowerCase();

    const isBlockedByName = blockedFields.has(coreLower);
    const isBlockedByPattern = blockedPatterns.some((p) =>
      coreLower.includes(p.toLowerCase()),
    );

    // Never strip aggregations or complex expressions — they don't expose
    // raw PII values and stripping them would break the query.
    const isAggregation = /^(count|sum|avg|min|max)\s*\(/i.test(field);

    if (!isAggregation && (isBlockedByName || isBlockedByPattern)) {
      stripped.push(core);
    } else {
      kept.push(field);
    }
  }

  // If everything was stripped, keep the query untouched — the validator
  // will pass but the caller will see totalSize=0 with a clear warning.
  if (kept.length === 0) {
    return { query, stripped: [] };
  }

  const newQuery = query.replace(
    match[0],
    `${selectKw}${kept.join(', ')}${fromKw}`,
  );
  return { query: newQuery, stripped };
}

/**
 * Split a SELECT field list on commas, respecting parentheses so
 * expressions like `COUNT(Id)` don't get cut in half.
 */
function splitSelectFields(clause: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of clause) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) result.push(current);
  return result;
}

/**
 * Pull the underlying field name out of a select expression. Handles:
 *   - "Name" → "Name"
 *   - "Name alias" → "Name"
 *   - "Account.Name" → "Account.Name"
 *   - "Field__c name" → "Field__c"
 */
function extractCoreFieldName(field: string): string {
  const stripped = field.trim().split(/\s+/)[0];
  return stripped;
}

/**
 * Parse the primary FROM object from a SOQL query. Only the top-level
 * FROM — not any inside subqueries.
 */
function extractPrimaryFromObject(query: string): string | null {
  // Find the first FROM outside any balanced parentheses.
  let depth = 0;
  const upper = query.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    const c = upper[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && upper.slice(i, i + 5) === 'FROM ') {
      const rest = query.slice(i + 5);
      const m = rest.match(/^\s*([A-Za-z_][\w]*)/);
      return m ? m[1] : null;
    }
  }
  return null;
}

function hasTestAccountFilter(query: string): boolean {
  return /\bTest_Account__c\s*=\s*false\b/i.test(query);
}

/**
 * Add `Test_Account__c = false` to the WHERE clause, inserting a new
 * WHERE if necessary. Preserves GROUP BY / ORDER BY / LIMIT ordering.
 */
function injectTestAccountFilter(query: string): string {
  // Find where WHERE ends / GROUP BY / ORDER BY / LIMIT begins
  const upper = query.toUpperCase();
  const whereIdx = findKeyword(upper, 'WHERE');
  const groupIdx = findKeyword(upper, 'GROUP BY');
  const orderIdx = findKeyword(upper, 'ORDER BY');
  const limitIdx = findKeyword(upper, 'LIMIT');

  const tailIdx = [groupIdx, orderIdx, limitIdx]
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];

  if (whereIdx >= 0) {
    // Append to existing WHERE
    const whereEnd =
      tailIdx != null && tailIdx > whereIdx ? tailIdx : query.length;
    const whereClause = query.slice(whereIdx, whereEnd).trim();
    const newWhere = `${whereClause} AND Test_Account__c = false`;
    return query.slice(0, whereIdx) + newWhere + ' ' + query.slice(whereEnd).trim();
  }

  // No WHERE — insert one before the tail keyword (or at end)
  const insertAt = tailIdx != null && tailIdx >= 0 ? tailIdx : query.length;
  const head = query.slice(0, insertAt).trimEnd();
  const tail = query.slice(insertAt).trim();
  return `${head} WHERE Test_Account__c = false${tail ? ' ' + tail : ''}`;
}

/**
 * Force a SOQL LIMIT clause to be at most `maxLimit`. If the query already has
 * a smaller LIMIT it's left alone; otherwise the LIMIT is replaced or appended.
 *
 * Used to enforce per-user batch-size caps so Salesforce never returns more
 * records than the caller is permitted to process.
 */
export function clampSoqlLimit(query: string, maxLimit: number): string {
  if (!Number.isFinite(maxLimit) || maxLimit <= 0) return query;
  const existing = /\bLIMIT\s+(\d+)\b/i.exec(query);
  if (existing) {
    const current = parseInt(existing[1], 10);
    if (current <= maxLimit) return query;
    return query.replace(existing[0], `LIMIT ${maxLimit}`);
  }
  return `${query.trimEnd()} LIMIT ${maxLimit}`;
}

function findKeyword(upper: string, keyword: string): number {
  // Word-boundary match, respects parentheses depth for the WHERE case.
  const pattern = new RegExp(`\\b${keyword.replace(/ /g, '\\s+')}\\b`);
  let depth = 0;
  for (let i = 0; i < upper.length; i++) {
    const c = upper[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0) {
      const m = pattern.exec(upper.slice(i));
      if (m && m.index === 0) return i;
    }
  }
  return -1;
}
