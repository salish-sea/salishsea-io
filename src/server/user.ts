import { db } from "./database.ts";

type UserRecord = {
  id: number;
  uuid: string;
  email: string;
}

const lookupByUUIDStmt = db.prepare<string, UserRecord>(`SELECT id, uuid, email from users where uuid=?`);
export const lookupByUUID = (uuid: string) => {
  return lookupByUUIDStmt.get(uuid);
};


const lookupByIDStmt = db.prepare<number, UserRecord>(`SELECT id, uuid, email from users where uuid=?`);
export const lookupById = (id: number) => {
  return lookupByIDStmt.get(id);
};
