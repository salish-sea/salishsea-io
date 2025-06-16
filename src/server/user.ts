import express from "express";
import { Temporal } from "temporal-polyfill";
import { withTimeout } from "../utils.ts";
import { db } from "./database.ts";

const upsertUserStatement = db.prepare<UserInfo>(`
INSERT INTO users
( sub,  name,  nickname,  email,  updated_at)
VALUES
(@sub, @name, @nickname, @email, @updated_at)
ON CONFLICT (sub) DO UPDATE
SET name=@name, nickname=@nickname, email=@email, updated_at=@updated_at
`);
const upsertUser = (info: UserInfo): number | bigint => {
  const result = upsertUserStatement.run(info);
  return result.lastInsertRowid;
};

const fetchUser = async (access_token: string) => {
  const url = `https://${process.env.VITE_AUTH0_DOMAIN}/userinfo`;
  const response = await withTimeout(10 * 1000, async (signal) => {
    const request = new Request(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${access_token}`,
      },
      signal,
    });
    return await fetch(request);
  })
  if (!response.ok)
    throw `Error fetching user: ${response.statusText}`;
  const payload: Auth0UserInfo = await response.json();
  const userInfo = {
    email: payload.email_verified ? payload.email : null,
    name: payload.name,
    nickname: payload.nickname,
    sub: payload.sub,
    updated_at: Temporal.Instant.from(payload.updated_at).epochMilliseconds / 1000,
  };
  return userInfo;
};

export type UserInfo = {
  email: string | null;
  name: string;
  nickname: string;
  sub: string;
  updated_at: number;
}

type Auth0UserInfo = {
  email: string;
  email_verified: boolean;
  family_name: string;
  given_name: string;
  name: string;
  nickname: string;
  picture: string;
  sub: string;
  updated_at: string;
}

export const storeUser: express.Handler = async (req, _res, next) => {
  const token = req.auth?.token;
  if (!token) {
    next();
    return;
  }
  const userInfo = await fetchUser(token);
  req.userId = upsertUser(userInfo);
  next();
}

declare global {
  namespace Express {
    interface Request {
      userId?: number | bigint;
    }
  }
}
