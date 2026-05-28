export type UserRole = "admin" | "user";

export type UserDTO = {
  id: string;
  role: UserRole;
};

export type Session<U extends UserDTO = UserDTO> = { user: U };
