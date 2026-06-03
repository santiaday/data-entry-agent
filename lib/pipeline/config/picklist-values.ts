/**
 * Picklist option sets referenced by field configs.
 *
 * These are EXACT mirrors of the Salesforce picklist definitions in the
 * Brain repo (Revops/salesforce/force-app/main/default/...). Changing a
 * value here without changing it in SF will cause extraction validation
 * failures. If a value set gets updated in SF, re-run the audit and
 * update this file + the de_field_configs rows in Supabase.
 *
 * Source of truth paths (as of last audit):
 *   - Inline value sets: objects/{Lead,Opportunity}/fields/AI_*__c.field-meta.xml
 *   - Global value sets: globalValueSets/*.globalValueSet-meta.xml
 *
 * Only ACTIVE values are included (isActive=false values are omitted).
 */

// ── Inline picklists (defined per-field in the SF metadata) ──

export const BUYER_PERSONA = [
  'Property Owner',
  'Property Manager',
  'Property Manager & Owner',
  'Enterprise Operator',
  'Other',
] as const;

export const PORTFOLIO_TYPE = [
  'Rentals',
  'Condos/Associations (HOA)',
] as const;

export const PORTFOLIO_SUBTYPE = [
  'Residential',
  'Commercial',
  'Residential & Commercial',
] as const;

/**
 * US States + territories + Other.
 * Order matches SF metadata (states alphabetical, then DC, then Other).
 */
export const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California',
  'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
  'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
  'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri',
  'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
  'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
  'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
  'District of Columbia', 'Other',
] as const;

export const BUYING_SCENARIO = [
  'Manual Method',
  'Patch of Tools',
  'Coming from a Competitor',
  'Just Acquired Properties',
  'Just Started a Property Management Company',
  'Other',
] as const;

export const DEAL_COMPLEXITY = [
  'Simple',
  'Standard',
  'Complex',
] as const;

export const TIMELINE_PICKLIST = [
  'ASAP',
  '30 Days',
  '60 Days',
  '90+ Days',
  'Exploratory',
] as const;

export const RECOMMENDED_PLAN = [
  'Starter',
  'Pro',
  'Premium',
] as const;

export const RECOMMENDED_TERM = [
  'Monthly',
  'Annual',
] as const;

export const DISCOUNT_DISCUSSED = [
  'None',
  '10%',
  '15%',
  '20%',
  '25%',
  '30%',
  'Free Month',
] as const;

export const DECISION_PROCESS_COMPLEXITY = [
  'Simple',
  'Standard',
  'Complex',
] as const;

// ── Global Value Sets (shared across multiple fields) ──

/**
 * Global value set: Previous_Software.
 * Referenced by AI_Current_Software__c, AI_Evaluating_Competitors__c (both
 * Lead and Opp), and AI_Competition_Picklist__c (Opp).
 *
 * This is the CANONICAL list from SF. Multiple variants exist intentionally
 * (e.g. "Excel/Word" and "Microsoft Excel/Word", "Manual - Pen/Paper" and
 * "Manual - Pen and Paper") — preserve exactly as in SF.
 */
export const PM_SOFTWARE = [
  'AppFolio',
  'Arthur Online',
  'Avail',
  'BuildingStack',
  'Buildium',
  'Cozy',
  'Entrata',
  'Excel/Word',
  'Google Sheets/Docs',
  'Hemlane',
  'Innago',
  'Landlord123',
  'LandlordStudio',
  'MagicDoor',
  'ManageCasa',
  'Manual - Pen/Paper',
  'Manual - Pen and Paper',
  'Microsoft Excel/Word',
  'MRI',
  'Never used anything before',
  'None',
  'Onesite',
  'Other',
  'PayHOA',
  'Other - PM Company',
  'PropertyBoss',
  'Property Matrix',
  'PropertyWare',
  'QuickBooks',
  'Real Page',
  'Re-Leased',
  'Rent Manager',
  'RentRedi',
  'RentTec Direct',
  'RentVine',
  'ResMan',
  'SimplifyEM',
  'SiteLink',
  'Skyline',
  'Stessa',
  'Tenant Cloud',
  'TurboTenant',
  'Unknown',
  'Unwilling to share',
  'Yardi Breeze',
  'Yardi Voyager',
  'Zillow',
] as const;

/**
 * Global value set: DoorLoop_Features.
 * Referenced by AI_Feature_Mentions__c (Lead and Opp).
 */
export const DOORLOOP_FEATURES = [
  '1099 Forms',
  '2 way texting communication',
  'Announcements with filters',
  'API Access',
  'Aptly - Integration',
  'Automated Notifications',
  'BankConnect',
  'Budgeting',
  'Bulk Post Charges / Credits',
  'Calendar',
  'CAM Reconciliation',
  'CashPayments',
  'Communication Center',
  'Convenience Fees',
  'CRM (automated) for prospects/owners with email templates and task',
  'eSignatures (Lease Doc)',
  'eSignatures (Other)',
  'File Sharing - Tenants',
  'Insurance (Commercial)',
  'Insurance (Residential)',
  'Late Fees',
  'Lead Simple - Integration',
  'Lease Renewals',
  'Listing Syndication',
  'Management Fees',
  'Manually tracking payments',
  'No QBO sync',
  'Other',
  'Outgoing Payments',
  'Owner Contribution',
  'Owner Distribution',
  'Owner Portal',
  'Owner Statements',
  'Portfolios (LLCs)',
  'PropertyMeld - Integration',
  'Prospect Tracking',
  'Reconciliation (Bank)',
  'Rental Applications & Screening',
  'Rent Collection Online',
  'Reports (Financial)',
  'Reports (Other)',
  'Reports (Prospect)',
  'Reports (Task)',
  'Security',
  'Tasks and Maintenance',
  'Tenant Portal',
  'Tenant Requests',
  'User Access Roles',
  'Vendor Communication',
  'Websites',
  'Zapier Integration',
] as const;

/**
 * Global value set: AI_Subscription_Loss_Reason.
 * Referenced by AI_Subscription_Loss_Reason__c (Opp-only).
 */
export const SUBSCRIPTION_LOSS_REASON = [
  'Total Cost Too Expensive (Subscription + AI Add-On)',
  'AI Cost Too Expensive (AI Add-On Only)',
  "Current Functionality Doesn't Properly Solve Customer's Needs",
  "Customer Doesn't Have Needs Solved By AI",
  'Missing Required Functionality',
  'Customer Refused Demo',
  "Rep Didn't Demo AI",
  "Customer Doesn't Trust AI",
  'Uses Other AI Solutions to Solve Needs',
  'Security/Compliance Concerns',
  "Employees Won't Adopt AI",
  "Tenants Won't Adopt AI",
] as const;
