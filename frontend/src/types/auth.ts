export interface LoginRequest {
  username: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: "bearer" | string;
}

export interface UserPublic {
  id: string;
  username: string;
  roles: string[];
}

export interface AuthState {
  token: string | null;
  user: UserPublic | null;
}
