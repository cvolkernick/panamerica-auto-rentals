export type OwnerJson = {
  id: number;
  name: string;
  email: string;
  /** Effective admin: stored flag, or the email is listed in ADMIN_EMAILS. */
  isAdmin: boolean;
  /** The owners.is_admin column. The admin form edits this. */
  storedAdmin: boolean;
  createdAt: string;
};

export type CarJson = {
  id: number;
  ownerId: number;
  year: number;
  make: string;
  model: string;
  color: string;
  licensePlate: string;
  vin: string;
  createdAt: string;
  updatedAt: string;
  ownerName?: string;
  ownerEmail?: string;
};

export type SessionJson = {
  email: string;
  owner: OwnerJson;
};

export type PortalErrorJson = {
  error: string;
  reason?: string;
  email?: string;
  fields?: Record<string, string>;
};
