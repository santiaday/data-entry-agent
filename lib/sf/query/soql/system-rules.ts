/**
 * System rule row shape. Used by the SOQL validator to enforce mandatory
 * query filters (e.g. excluding test accounts) loaded from the database.
 */
export type SystemRuleRow = {
  id: string;
  org_id: string;
  category: string;
  rule_name: string;
  system: string | null;
  description: string | null;
  rule_config: unknown;
  is_mandatory: boolean;
  applies_to_objects: string[];
  enforced_by: string[];
};
