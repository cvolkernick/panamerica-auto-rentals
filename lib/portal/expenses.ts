export const EXPENSE_CATEGORIES = [
  "maintenance",
  "cleaning",
  "tolls",
  "insurance",
  "commission",
  "fuel",
  "registration",
  "parking",
  "supplies",
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS = {
  maintenance: "Maintenance",
  cleaning: "Cleaning",
  tolls: "Tolls",
  insurance: "Insurance",
  commission: "Commission",
  fuel: "Fuel",
  registration: "Registration",
  parking: "Parking",
  supplies: "Supplies",
  other: "Other",
} as const satisfies Record<ExpenseCategory, string>;

export function isExpenseCategory(value: string): value is ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}
