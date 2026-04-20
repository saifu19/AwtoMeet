export interface OwnedResource {
  user_id: string;
  org_id: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  org_ids?: string[];
}
