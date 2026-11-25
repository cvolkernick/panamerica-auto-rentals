/**
 * Single source of truth for what the team car connector (MCP) can and cannot do.
 * SERVER ONLY: served to admins by GET /api/portal/admin/connector-capabilities and rendered
 * by /admin/connector/. Never import this from a client component or page; the content must
 * stay out of the public static bundle (tests/build/connector-bundle.test.ts checks out/). tests/portal/connector-capabilities.test.ts fails if
 * this list drifts from tools/car-connector-mcp/panam_car_mcp.py or the API limits.
 * When a tool or rule changes, update this file and bump `updated`.
 * No token values, secrets, or endpoint credentials belong here.
 */

export type ConnectorTool = {
  /** MCP tool name, exactly as registered in panam_car_mcp.py. */
  name: string;
  access: "read" | "write";
  summary: string;
};

export const CONNECTOR_DOC = {
  title: "Team connector (MCP)",
  updated: "2026-11-25",
  version: "FE-4 + manager lookup + read-only token",
} as const;

/** Per-entry ceiling for expenses and income, in cents. Must equal MAX_ENTRY_CENTS in team-store.ts. */
export const CONNECTOR_MAX_ENTRY_CENTS = 5_000_000;

/** Expense categories the connector accepts. Commission is booked by the statement, never here. */
export const CONNECTOR_EXPENSE_CATEGORIES = [
  "maintenance",
  "cleaning",
  "tolls",
  "insurance",
  "fuel",
  "registration",
  "parking",
  "supplies",
  "other",
] as const;

export const CONNECTOR_TOOLS: readonly ConnectorTool[] = [
  { name: "panam_list_cars", access: "read", summary: "List fleet cars: year, make, model, color, plate, VIN, owner id." },
  { name: "panam_get_car", access: "read", summary: "Read one car by id." },
  {
    name: "panam_update_car",
    access: "write",
    summary: "Edit year, make, model, color, plate, or VIN. Cannot change the owner.",
  },
  { name: "panam_list_expenses", access: "read", summary: "List a car's expenses, optionally for one month." },
  {
    name: "panam_add_expense",
    access: "write",
    summary: "Add one expense from structured fields (date, category, amount, short note).",
  },
  {
    name: "panam_update_expense",
    access: "write",
    summary: "Correct an expense's date, category, amount, or note. Commission rows are refused.",
  },
  {
    name: "panam_delete_expense",
    access: "write",
    summary: "Delete an expense the connector itself created. Admin-entered rows are refused.",
  },
  {
    name: "panam_list_income",
    access: "read",
    summary: "List a car's trip income (Turo and Wheelbase imports plus manual entries).",
  },
  {
    name: "panam_add_income",
    access: "write",
    summary: "Add one trip's income by hand: dates and the platform's net payout.",
  },
  {
    name: "panam_update_income",
    access: "write",
    summary: "Correct a manual income entry. Imported trips are read-only.",
  },
  {
    name: "panam_delete_income",
    access: "write",
    summary: "Delete a manual income entry the connector itself created.",
  },
  {
    name: "panam_get_statement",
    access: "read",
    summary: "Read a car's monthly statement: income, expenses, fee, balance, payout due.",
  },
  {
    name: "panam_get_car_manager",
    access: "read",
    summary: "Read who manages a car today: manager name, since date, contact reference, and company or client owned.",
  },
  {
    name: "panam_list_car_managers",
    access: "read",
    summary: "Read today's manager for every car, to route car questions to the right person.",
  },
  {
    name: "panam_get_write_log",
    access: "read",
    summary: "Read recent connector writes with the agent name, action, before and after.",
  },
];

/** Things the connector refuses or does not have. Keep each one true of the current code. */
export const CONNECTOR_NOT_SUPPORTED: readonly string[] = [
  "Receipt photo parsing. The calling agent reads the receipt and sends structured fields.",
  "Commission expenses. The management fee is figured by the statement from trip income.",
  "Editing, recategorizing, or deleting commission rows (admin only).",
  "Owner names, emails, or any other owner PII. Cars carry the owner id only.",
  "Manager emails or phone numbers. The manager lookup gives a contact reference only.",
  "Assigning or changing a car's manager (admin only).",
  "Guest data of any kind. Expense notes with an email or phone number are refused.",
  "Entries over $50,000 per expense or income entry.",
  "Editing or deleting imported Turo or Wheelbase trips. Fix those with a corrected re-import.",
  "Deleting expenses or income an admin entered.",
  "Creating or deleting cars, or moving a car to another owner.",
  "Owners, invites, logins, or trip imports.",
  "Payouts, period close, or changing the fee tiers.",
];

/** Rules every write follows. */
export const CONNECTOR_RULES: readonly string[] = [
  "Every write is saved together with a log row naming the agent. If the log row fails, the write does not happen.",
  "Expenses come out of the car's proceeds. A shortfall carries forward. Payouts happen only on a net surplus.",
  "The fee is taken per trip on the platform's net payout: 20% under 7 days, 15% for 7 to 21 days, 10% over 21 days.",
  "Each car is self-contained. Nothing moves between cars.",
  "Access needs the team service token. Requests are rate limited.",
  "A read-only team token can use the read tools only. Write tools answer with a read-only error and nothing is saved or logged.",
];

/** JSON body for GET /api/portal/admin/connector-capabilities (admin session only). */
export function connectorCapabilitiesJson() {
  return {
    title: CONNECTOR_DOC.title,
    updated: CONNECTOR_DOC.updated,
    version: CONNECTOR_DOC.version,
    maxEntryCents: CONNECTOR_MAX_ENTRY_CENTS,
    expenseCategories: [...CONNECTOR_EXPENSE_CATEGORIES],
    tools: CONNECTOR_TOOLS.map((tool) => ({ ...tool })),
    notSupported: [...CONNECTOR_NOT_SUPPORTED],
    rules: [...CONNECTOR_RULES],
  };
}

export type ConnectorCapabilitiesJson = ReturnType<typeof connectorCapabilitiesJson>;
